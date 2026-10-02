FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY requirements.txt .

# The pip cache mount keeps downloaded wheels between builds, so a requirements change
# (or a retry after a network failure) doesn't re-download everything.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --root-user-action=ignore -r requirements.txt

COPY . .

# Run as an unprivileged user
RUN useradd --system --uid 10001 --no-create-home app && chown -R app:app /app
USER app

EXPOSE 8000

# Bring the schema to head and make sure the superadmin exists (both idempotent), then serve.
# `&&` means a failed migration or a missing SUPERADMIN_PASSWORD stops the container
# instead of starting an API that can't work.
CMD ["sh", "-c", "alembic upgrade head && python seed_superadmin.py && exec uvicorn main:app --host 0.0.0.0 --port 8000"]
