"""SMS provider adapters, against a mocked HTTP transport (no network)."""
import httpx
import pytest

from services import sms
from services.sms.providers import AfricasTalkingProvider, WebhookSmsProvider


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def at_response(code, status="Success", message_id="ATXid_1"):
    return {"SMSMessageData": {"Message": "Sent to 1/1", "Recipients": [
        {"statusCode": code, "number": "+254712345678", "status": status, "messageId": message_id}]}}


def test_africastalking_accepts_and_sends_the_right_request():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"], seen["headers"], seen["body"] = str(request.url), request.headers, request.content.decode()
        return httpx.Response(201, json=at_response(101))

    provider = AfricasTalkingProvider("milkos", "key-123", sender_id="MILKOS", client=client(handler))
    result = provider.send_sms("+254712345678", "hello")
    assert result.accepted and result.provider_message_id == "ATXid_1"
    assert seen["url"] == AfricasTalkingProvider.LIVE_URL
    assert seen["headers"]["apiKey"] == "key-123"
    assert "username=milkos" in seen["body"] and "from=MILKOS" in seen["body"]


@pytest.mark.parametrize("code,retryable", [(403, False), (405, True), (500, True)])
def test_africastalking_refusals(code, retryable):
    provider = AfricasTalkingProvider("u", "k", client=client(lambda r: httpx.Response(201, json=at_response(code, "InvalidPhoneNumber"))))
    result = provider.send_sms("+254712345678", "x")
    assert not result.accepted and result.retryable is retryable


def test_africastalking_network_error_is_retryable():
    def handler(request):
        raise httpx.ConnectError("down")

    result = AfricasTalkingProvider("u", "k", client=client(handler)).send_sms("+254712345678", "x")
    assert not result.accepted and result.retryable


def test_webhook_provider():
    ok = WebhookSmsProvider("https://gw.example/sms", "t", client=client(lambda r: httpx.Response(200, json={"message_id": "m1"})))
    assert ok.send_sms("+254712345678", "x").provider_message_id == "m1"
    bad = WebhookSmsProvider("https://gw.example/sms", client=client(lambda r: httpx.Response(400)))
    result = bad.send_sms("+254712345678", "x")
    assert not result.accepted and not result.retryable


def test_provider_selection_from_environment(monkeypatch):
    sms.reset_provider()
    monkeypatch.delenv("SMS_PROVIDER", raising=False)
    assert sms.get_provider() is None
    monkeypatch.setenv("SMS_PROVIDER", "africastalking")
    with pytest.raises(sms.SmsProviderError):
        sms.get_provider()  # credentials missing
    monkeypatch.setenv("AFRICASTALKING_USERNAME", "sandbox")
    monkeypatch.setenv("AFRICASTALKING_API_KEY", "k")
    monkeypatch.setenv("AFRICASTALKING_SANDBOX", "true")
    provider = sms.get_provider()
    assert provider.name == "africastalking" and provider.url == AfricasTalkingProvider.SANDBOX_URL
    monkeypatch.setenv("SMS_PROVIDER", "carrier-pigeon")
    with pytest.raises(sms.SmsProviderError):
        sms.get_provider()
