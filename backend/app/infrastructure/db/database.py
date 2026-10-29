from urllib.parse import parse_qs, urlencode, urlparse, urlunparse
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

def clean_db_url(url_str: str) -> str:
    # Ensure standard synchronous driver prefix
    if "+asyncpg" in url_str:
        url_str = url_str.replace("+asyncpg", "")
    
    parsed = urlparse(url_str)
    query_params = parse_qs(parsed.query)
    
    # Replace invalid 'ssl' with 'sslmode' for psycopg 3
    if "ssl" in query_params:
        ssl_val = query_params.pop("ssl")[0]
        if ssl_val in ("require", "verify-full", "prefer"):
            query_params["sslmode"] = [ssl_val]
            
    # For localhost, remove sslmode entirely to avoid connection issues
    if parsed.hostname in ("localhost", "127.0.0.1"):
        query_params.pop("sslmode", None)
        
    new_query = urlencode(query_params, doseq=True)
    return urlunparse(parsed._replace(query=new_query))

DATABASE_URL = clean_db_url(str(settings.DATABASE_URL))

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()