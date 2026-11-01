import smtplib
import ssl
from email.message import EmailMessage

from ..config import SMTP_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_TLS, SMTP_USER


def send_password_reset(to_email: str, reset_url: str) -> None:
    if not SMTP_HOST:
        raise RuntimeError("SMTP is not configured.")
    message = EmailMessage()
    message["Subject"] = "Reset your AI Engineering Companion password"
    message["From"] = SMTP_FROM
    message["To"] = to_email
    message.set_content(
        "A password reset was requested for your AI Engineering Companion account.\n\n"
        f"Open this link within 30 minutes to choose a new password:\n\n{reset_url}\n\n"
        "If you did not request this, you can ignore this email. Your password will not change."
    )
    context = ssl.create_default_context()
    if SMTP_TLS and SMTP_PORT == 465:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=20) as server:
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(message)
        return
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
        server.ehlo()
        if SMTP_TLS:
            server.starttls(context=context)
            server.ehlo()
        if SMTP_USER:
            server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(message)


def smtp_available() -> bool:
    return bool(SMTP_HOST)
