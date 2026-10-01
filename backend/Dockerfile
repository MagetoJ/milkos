FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Bring the schema to head and make sure the superadmin exists (both idempotent), then serve
CMD ["sh", "-c", "alembic upgrade head && python seed_superadmin.py && exec uvicorn main:app --host 0.0.0.0 --port 8000"]
