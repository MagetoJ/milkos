from datetime import datetime, timezone
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_user
from app.models.collection import MilkCollection
from app.models.farmer import Farmer
from app.models.user import User
from app.schemas.sync import (
    SyncPushRequest,
    SyncPushResponse,
    SyncMutationResult,
    SyncPullResponse,
)

router = APIRouter()

@router.head("/health")
@router.get("/health")
async def health_check():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}

@router.post("/sync/push", response_model=SyncPushResponse)
async def sync_push(
    body: SyncPushRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    results: list[SyncMutationResult] = []

    for item in body.mutations:
        try:
            p = item.payload
            if item.action == "CREATE_COLLECTION":
                stmt = (
                    pg_insert(MilkCollection)
                    .values(
                        client_tx_id=item.client_tx_id,
                        cooperative_id=current_user.cooperative_id,
                        farmer_id=UUID(str(p["farmer_id"])),
                        collector_id=current_user.id,
                        weight_kg=p["weight_kg"],
                        grade=p.get("grade", "A"),
                        shift=p.get("shift", "MORNING"),
                        collected_at=datetime.fromisoformat(p["collected_at"].replace("Z", "+00:00")),
                        updated_at=datetime.fromisoformat(p["updated_at"].replace("Z", "+00:00")),
                    )
                    .on_conflict_do_nothing(index_elements=["client_tx_id"])
                    .returning(MilkCollection.id)
                )
                res = await db.execute(stmt)
                inserted_id = res.scalar_one_or_none()

                if inserted_id is None:
                    existing = await db.execute(
                        select(MilkCollection.id).where(
                            MilkCollection.client_tx_id == item.client_tx_id,
                            MilkCollection.cooperative_id == current_user.cooperative_id,
                        )
                    )
                    inserted_id = existing.scalar_one()

                await db.commit()
                results.append(
                    SyncMutationResult(
                        queue_id=item.id,
                        client_tx_id=item.client_tx_id,
                        server_id=inserted_id,
                        status="ok",
                    )
                )

            elif item.action == "UPDATE_COLLECTION":
                q = await db.execute(
                    select(MilkCollection).where(
                        MilkCollection.client_tx_id == item.client_tx_id,
                        MilkCollection.cooperative_id == current_user.cooperative_id,
                    )
                )
                record = q.scalar_one_or_none()
                if not record:
                    raise ValueError("Target collection record not found on server")

                client_updated = datetime.fromisoformat(p["updated_at"].replace("Z", "+00:00"))
                if client_updated >= record.updated_at:
                    record.weight_kg = p.get("weight_kg", record.weight_kg)
                    record.grade = p.get("grade", record.grade)
                    record.shift = p.get("shift", record.shift)
                    record.updated_at = client_updated
                    await db.commit()

                results.append(
                    SyncMutationResult(
                        queue_id=item.id,
                        client_tx_id=item.client_tx_id,
                        server_id=record.id,
                        status="ok",
                    )
                )

        except Exception as exc:
            await db.rollback()
            results.append(
                SyncMutationResult(
                    queue_id=item.id,
                    client_tx_id=item.client_tx_id,
                    status="error",
                    error=str(exc),
                )
            )

    return SyncPushResponse(results=results)

@router.get("/sync/pull", response_model=SyncPullResponse)
async def sync_pull(
    since: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server_now = datetime.now(timezone.utc)
    stmt = select(Farmer).where(Farmer.cooperative_id == current_user.cooperative_id)
    if since:
        stmt = stmt.where(Farmer.updated_at > since)

    res = await db.execute(stmt)
    farmers = res.scalars().all()
    return SyncPullResponse(farmers=farmers, server_time=server_now)
