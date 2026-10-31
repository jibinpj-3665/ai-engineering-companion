from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.analytics import analytics_overview, dashboard

router = APIRouter(tags=["analytics"])


@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db)):
    return dashboard(db)


@router.get("/analytics")
def get_analytics(db: Session = Depends(get_db)):
    return analytics_overview(db)
