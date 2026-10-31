import os

import uvicorn

from app.config import HOST, PORT
from app.main import app

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=HOST,
        port=int(os.environ.get("AEC_PORT", PORT)),
        log_level="info",
        access_log=False,
    )
