from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.request_context import RequestContext, get_request_context
from app.db.session import get_db
from app.models.cooperative import Cooperative, CooperativeApplication, CooperativeStatus
from app.schemas.cooperatives.registration import (
    AdminApplicationResponse,
    ApplicationStatusResponse,
    ApplicationSubmittedResponse,
    ConfirmVerificationRequest,
    ConfirmVerificationResponse,
    CooperativeResponse,
    ReviewApplicationRequest,
    StartVerificationRequest,
    StartVerificationResponse,
    SubmitApplicationRequest,
)
from app.security.authorization import (
    AuthenticatedIdentity,
    TenantContext,
    get_or_provision_identity,
    require_cooperative_membership,
    require_platform_role,
)
from app.services.cooperatives import registration

router = APIRouter(prefix="/cooperatives", tags=["cooperatives"])


def _status_response(
    application: CooperativeApplication, cooperative: Cooperative
) -> ApplicationStatusResponse:
    return ApplicationStatusResponse(
        reference=application.reference,
        status=application.status,
        cooperative_name=cooperative.name,
        submitted_at=application.submitted_at,
        reviewed_at=application.reviewed_at,
        notes=application.notes,
        requested_information=application.requested_information,
    )


def _admin_response(
    application: CooperativeApplication, cooperative: Cooperative
) -> AdminApplicationResponse:
    return AdminApplicationResponse(
        id=application.id,
        reference=application.reference,
        status=application.status,
        cooperative_id=cooperative.id,
        cooperative_name=cooperative.name,
        registration_number=cooperative.registration_number,
        applicant_user_id=application.applicant_user_id,
        contact_phone=application.contact_phone,
        contact_email=application.contact_email,
        location=application.location,
        submitted_at=application.submitted_at,
        reviewed_at=application.reviewed_at,
        notes=application.notes,
    )


# --- Applicant onboarding (any signed-in Keycloak user) ---------------------


@router.post("/registration/verify/start", response_model=StartVerificationResponse)
async def start_verification(
    payload: StartVerificationRequest,
    identity: AuthenticatedIdentity = Depends(get_or_provision_identity),
    db: AsyncSession = Depends(get_db),
    ctx: RequestContext = Depends(get_request_context),
) -> StartVerificationResponse:
    verification, dev_code = await registration.start_verification(
        db, identity.user, payload, ctx
    )
    return StartVerificationResponse(
        verification_id=verification.id,
        expires_at=verification.expires_at,
        delivery="development_code" if dev_code else "sent",
        code=dev_code,
    )


@router.post("/registration/verify/confirm", response_model=ConfirmVerificationResponse)
async def confirm_verification(
    payload: ConfirmVerificationRequest,
    identity: AuthenticatedIdentity = Depends(get_or_provision_identity),
    db: AsyncSession = Depends(get_db),
    ctx: RequestContext = Depends(get_request_context),
) -> ConfirmVerificationResponse:
    verification = await registration.confirm_verification(
        db, identity.user, payload.verification_id, payload.code, ctx
    )
    return ConfirmVerificationResponse(verified=True, verification_id=verification.id)


@router.post(
    "/applications",
    response_model=ApplicationSubmittedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_application(
    payload: SubmitApplicationRequest,
    identity: AuthenticatedIdentity = Depends(get_or_provision_identity),
    db: AsyncSession = Depends(get_db),
    ctx: RequestContext = Depends(get_request_context),
) -> ApplicationSubmittedResponse:
    application = await registration.submit_application(db, identity.user, payload, ctx)
    return ApplicationSubmittedResponse(
        application_id=application.id,
        reference=application.reference,
        status=application.status,
    )


@router.get("/applications/mine", response_model=list[ApplicationStatusResponse])
async def list_my_applications(
    identity: AuthenticatedIdentity = Depends(get_or_provision_identity),
    db: AsyncSession = Depends(get_db),
) -> list[ApplicationStatusResponse]:
    rows = await registration.list_my_applications(db, identity.user)
    return [_status_response(application, cooperative) for application, cooperative in rows]


@router.get("/applications/by-reference/{reference}", response_model=ApplicationStatusResponse)
async def get_my_application(
    reference: str,
    identity: AuthenticatedIdentity = Depends(get_or_provision_identity),
    db: AsyncSession = Depends(get_db),
) -> ApplicationStatusResponse:
    application, cooperative = await registration.get_my_application(
        db, identity.user, reference.strip()
    )
    return _status_response(application, cooperative)


# --- Platform administration ------------------------------------------------


@router.get("/applications", response_model=list[AdminApplicationResponse])
async def list_applications(
    status_filter: CooperativeStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: AuthenticatedIdentity = Depends(require_platform_role()),
    db: AsyncSession = Depends(get_db),
) -> list[AdminApplicationResponse]:
    rows = await registration.list_applications(db, status_filter, limit, offset)
    return [_admin_response(application, cooperative) for application, cooperative in rows]


@router.post("/applications/{application_id}/review", response_model=AdminApplicationResponse)
async def review_application(
    application_id: UUID,
    payload: ReviewApplicationRequest,
    reviewer: AuthenticatedIdentity = Depends(require_platform_role()),
    db: AsyncSession = Depends(get_db),
    ctx: RequestContext = Depends(get_request_context),
) -> AdminApplicationResponse:
    application, cooperative = await registration.review_application(
        db, reviewer.user, application_id, payload, ctx
    )
    return _admin_response(application, cooperative)


# --- Tenant-scoped ----------------------------------------------------------


@router.get("/{cooperative_id}", response_model=CooperativeResponse)
async def get_cooperative(
    tenant: TenantContext = Depends(require_cooperative_membership()),
    db: AsyncSession = Depends(get_db),
) -> CooperativeResponse:
    cooperative = await db.scalar(
        select(Cooperative).where(Cooperative.id == tenant.cooperative_id)
    )
    return CooperativeResponse(
        id=cooperative.id,
        name=cooperative.name,
        status=cooperative.status,
        currency=cooperative.currency,
        roles=sorted(tenant.roles),
    )
