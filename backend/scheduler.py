from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.ext.asyncio import AsyncSession
import crud
import task_notification_service
from database import get_db, settings

router = APIRouter()

async def verify_cron_secret(x_cron_secret: str = Header(...)):
    if x_cron_secret != settings.ADMIN_API_KEY:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid secret")

@router.post("/scheduler/run-daily-tasks", dependencies=[Depends(verify_cron_secret)])
async def run_daily_tasks(db: AsyncSession = Depends(get_db)):
    birthdays_processed = await crud.process_birthday_bonuses(db)
    await crud.reset_tickets(db)
    await crud.reset_daily_transfer_limits(db)
    return {"status": "ok", "birthdays_processed": birthdays_processed}


@router.post("/scheduler/task-notifications/morning", dependencies=[Depends(verify_cron_secret)])
async def run_morning_task_notifications(db: AsyncSession = Depends(get_db)):
    """Ручной запуск утренних уведомлений (основной режим — встроенный планировщик task_scheduler)."""
    sent = await task_notification_service.send_morning_task_refresh_notifications(db)
    return {"status": "ok", "sent": sent}


@router.post("/scheduler/task-notifications/evening", dependencies=[Depends(verify_cron_secret)])
async def run_evening_task_notifications(db: AsyncSession = Depends(get_db)):
    """Ручной запуск вечерних напоминаний (основной режим — встроенный планировщик task_scheduler)."""
    sent = await task_notification_service.send_evening_task_reminder_notifications(db)
    return {"status": "ok", "sent": sent}

@router.post("/run-monthly-tasks")
async def run_monthly_tasks(
    x_cron_secret: str = Header(None),
    db: AsyncSession = Depends(get_db)
):
    if x_cron_secret != settings.ADMIN_API_KEY:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid secret")
    
    try:
        await crud.generate_monthly_leaderboard_banners(db)
        return {"status": "monthly leaderboard banners generated"}
    except Exception as e:
        print(f"Error during monthly tasks: {e}")
        raise HTTPException(status_code=500, detail="Error processing monthly tasks")
