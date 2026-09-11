from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

import crud
import schemas
import models
from database import get_db
from dependencies import get_current_user

router = APIRouter(
    prefix="/sessions",
    tags=["sessions"],
    dependencies=[Depends(get_current_user)]
)

@router.post("/start", response_model=schemas.SessionResponse)
async def start_session(
    payload: schemas.SessionStartRequest | None = None,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    body = payload or schemas.SessionStartRequest()
    new_session = await crud.start_user_session(
        db=db,
        user_id=current_user.id,
        client_platform=body.client_platform,
        client_shell=body.client_shell,
    )
    return new_session

@router.put("/ping/{session_id}", response_model=schemas.SessionResponse)
async def ping_session(
    session_id: int,
    db: AsyncSession = Depends(get_db)
):
    session = await crud.ping_user_session(db=db, session_id=session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session
