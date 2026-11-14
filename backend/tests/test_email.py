"""Email provider adapter (mocked HTTP) and the account/applicant emails sent through the gateway."""
import httpx
import pytest

from app.domain.interfaces.email import EmailResult
from app.domain.interfaces.sms import GatewayConfigurationError
from app.infrastructure.gateways import email as email_gateway
from app.infrastructure.gateways.email.providers import ResendProvider
from app.services import email_notices
from app.services.applicant_notifications import notify_applicant
from tests.test_accounts import NEW_PHONE, invite_collector, world


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


class RecordingEmail:
    name = "recording"

    def __init__(self, accepted=True):
        self.sent, self.accepted = [], accepted

    def send_email(self, to, subject, html, text):
        self.sent.append({"to": to, "subject": subject, "html": html, "text": text})
        return EmailResult(self.accepted, provider_message_id="m1" if self.accepted else None, error=None if self.accepted else "boom")


@pytest.fixture(autouse=True)
def _reset_provider():
    yield
    email_gateway.reset_provider()


def test_resend_sends_the_right_request():
    seen = {}

    def handler(request: httpx.Request):
        seen["auth"], seen["body"] = request.headers["authorization"], request.read().decode()
        return httpx.Response(200, json={"id": "re_1"})

    result = ResendProvider("key-1", "MilkOS <no-reply@milkos.app>", client=client(handler)).send_email("a@b.co", "Hi", "<p>x</p>", "x")
    assert result.accepted and result.provider_message_id == "re_1"
    assert seen["auth"] == "Bearer key-1" and "no-reply@milkos.app" in seen["body"] and '"to":["a@b.co"]' in seen["body"].replace(" ", "")


@pytest.mark.parametrize("status,retryable", [(422, False), (403, False), (429, True), (500, True)])
def test_resend_failures(status, retryable):
    result = ResendProvider("k", "a@b.co", client=client(lambda r: httpx.Response(status, json={"message": "nope"}))).send_email("x@y.co", "s", "h", "t")
    assert not result.accepted and result.retryable is retryable


def test_resend_network_error_is_retryable():
    def handler(request):
        raise httpx.ConnectError("down")

    result = ResendProvider("k", "a@b.co", client=client(handler)).send_email("x@y.co", "s", "h", "t")
    assert not result.accepted and result.retryable


def test_provider_selection(monkeypatch):
    # Ignore anything a developer's local .env put in the environment.
    for var in ("EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM"):
        monkeypatch.delenv(var, raising=False)
    assert email_gateway.get_provider() is None
    monkeypatch.setenv("EMAIL_PROVIDER", "resend")
    with pytest.raises(GatewayConfigurationError):
        email_gateway.get_provider()
    monkeypatch.setenv("RESEND_API_KEY", "k")
    monkeypatch.setenv("EMAIL_FROM", "MilkOS <no-reply@milkos.app>")
    assert email_gateway.get_provider().name == "resend"
    monkeypatch.setenv("EMAIL_PROVIDER", "carrier-pigeon")
    with pytest.raises(GatewayConfigurationError):
        email_gateway.get_provider()


def test_send_never_raises_and_skips_quietly():
    assert email_notices.send(None, {"subject": "s", "html": "h", "text": "t"}, kind="X") is None  # no address
    email_gateway.set_provider(None)
    assert email_notices.send("a@b.co", {"subject": "s", "html": "h", "text": "t"}, kind="X") is None  # no provider

    class Exploding:
        name = "exploding"

        def send_email(self, *a):
            raise RuntimeError("kaboom")

    email_gateway.set_provider(Exploding())
    assert email_notices.send("a@b.co", {"subject": "s", "html": "h", "text": "t"}, kind="X").accepted is False


def test_activation_email_links_to_the_real_activation_page_and_escapes_names():
    msg = email_notices.activation_email('Jo <script>', "Kiambu Dairy", "http://localhost:3000/activate-account#t=abc", "30 minutes")
    assert "http://localhost:3000/activate-account#t=abc" in msg["text"] and "http://localhost:3000/activate-account#t=abc" in msg["html"]
    assert "<script>" not in msg["html"] and "Kiambu Dairy" in msg["subject"]


def test_applicant_emails():
    rec = RecordingEmail()
    email_gateway.set_provider(rec)

    class App:
        id, org_name, email, phone = 1, "Kiambu Dairy", "coop@example.com", "+254712345678"

    for event in ("APPLICATION_RECEIVED", "APPLICATION_APPROVED", "APPLICATION_REJECTED"):
        notify_applicant(App, event)
    assert [m["to"] for m in rec.sent] == ["coop@example.com"] * 3
    assert "approved" in rec.sent[1]["subject"]


def test_unknown_applicant_event_sends_nothing():
    assert email_notices.applicant_email("NOPE", "x") is None


# ---------------- through the real invitation flow ----------------

def test_invitation_sends_email_with_the_same_link_as_the_sms(client, world):
    rec = RecordingEmail()
    email_gateway.set_provider(rec)
    invite_collector(client, world)
    assert len(rec.sent) == 1 and rec.sent[0]["to"]
    token = world["sms"].token_for(NEW_PHONE)
    assert f"/activate-account#t={token}" in rec.sent[0]["text"] and f"/activate-account#t={token}" in rec.sent[0]["html"]


def test_failing_email_provider_does_not_break_the_invitation_or_the_sms(client, world):
    email_gateway.set_provider(RecordingEmail(accepted=False))
    body = invite_collector(client, world)
    assert body["activation_sms"]["sms_status"] == "SENT"
    assert world["sms"].token_for(NEW_PHONE)


def test_no_email_provider_configured_changes_nothing(client, world):
    email_gateway.set_provider(None)
    assert invite_collector(client, world)["activation_sms"]["sms_status"] == "SENT"
    assert world["sms"].token_for(NEW_PHONE)
