from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, BigInteger, Boolean, Date, Text, func
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.dialects.postgresql import JSON, BYTEA
from sqlalchemy.orm import relationship, Mapped, mapped_column
from database import Base
from datetime import date, datetime
from typing import Optional

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    telegram_id = Column(BigInteger, nullable=True)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=False)
    status = Column(String, default='pending', nullable=False)
    position = Column(String, nullable=False)
    department = Column(String, nullable=False)
    username = Column(String, nullable=True)
    telegram_photo_url = Column(String, nullable=True)
    phone_number = Column(String, nullable=False)
    date_of_birth = Column(Date, nullable=True)
    email = Column(String, nullable=True)  # Email пользователя для рассылок и уведомлений
    balance = Column(Integer, default=0)
    reserved_balance = Column(Integer, default=0)
    is_admin = Column(Boolean, default=False, nullable=False)
    daily_transfer_count = Column(Integer, default=0)
    daily_transfer_count_for_date = Column(Date, nullable=True)
    last_login_date: Mapped[datetime] = mapped_column(DateTime, nullable=True, onupdate=func.now())
    ticket_parts = Column(Integer, default=0)
    tickets = Column(Integer, default=0)
    last_ticket_part_reset = Column(Date, default=datetime.utcnow)
    last_ticket_reset = Column(Date, default=datetime.utcnow)
    card_barcode = Column(String, nullable=True) # Поле для хранения данных штрих-кода
    card_balance = Column(String, nullable=True) # Поле для хранения баланса карты
    registration_date = Column(DateTime, default=func.now())
    
    # Поля для аутентификации через браузер
    # Поля login и password_hash могут быть NULL, так как не все пользователи используют вход через браузер
    login = Column(String(255), nullable=True, unique=True) # Уникальный логин для входа в браузере (может быть NULL)
    password_hash = Column(String(255), nullable=True) # Хеш пароля для входа в браузере (может быть NULL)
    password_plain = Column(String(255), nullable=True) # Пароль в открытом виде (только для админов, может быть NULL)
    browser_auth_enabled = Column(Boolean, default=False, nullable=False) # Флаг, что пользователь может входить через браузер
    can_publish_feed_posts = Column(Boolean, default=False, server_default='false', nullable=False)
    avatar_storage_key = Column(String(512), nullable=True)
    avatar_updated_at = Column(DateTime, nullable=True)
    avatar_webp: Mapped[Optional[bytes]] = mapped_column(BYTEA, nullable=True)

    has_seen_onboarding: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false', nullable=False)
    has_interacted_with_bot: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false', nullable=False)
    sent_transactions = relationship(
        "Transaction",
        back_populates="sender",
        foreign_keys="Transaction.sender_id",
        cascade="all, delete-orphan",
        passive_deletes=True
    )
    received_transactions = relationship(
        "Transaction",
        back_populates="receiver",
        foreign_keys="Transaction.receiver_id",
        cascade="all, delete-orphan",
        passive_deletes=True
    )
    purchases = relationship("Purchase", back_populates="user")
    pending_updates = relationship("PendingUpdate", back_populates="user")

    sessions = relationship("UserSession", back_populates="user", cascade="all, delete-orphan", passive_deletes=True)

class UserSession(Base):
    __tablename__ = 'user_sessions'

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete="CASCADE"))

    session_start: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="sessions")
    
class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    receiver_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Integer, nullable=False)
    message = Column(String, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    sender = relationship("User", back_populates="sent_transactions", foreign_keys=[sender_id], lazy='selectin')
    receiver = relationship("User", back_populates="received_transactions", foreign_keys=[receiver_id], lazy='selectin')

class MarketItem(Base):
    __tablename__ = "market_items"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    price = Column(Integer, nullable=False)
    price_rub = Column(Integer, nullable=False) 
    stock = Column(Integer, default=0)
    original_price: Mapped[Optional[int]]
    image_url = Column(String, nullable=True)
    is_archived = Column(Boolean, default=False, nullable=False)
    archived_at = Column(DateTime, nullable=True)
    is_auto_issuance: Mapped[bool] = mapped_column(default=False)
    is_shared_gift: Mapped[bool] = mapped_column(default=False)
    is_local_purchase: Mapped[bool] = mapped_column(default=False)
    purchases = relationship("Purchase", back_populates="item")
    codes = relationship("ItemCode", back_populates="market_item", cascade="all, delete-orphan")

class Purchase(Base):
    __tablename__ = "purchases"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("market_items.id"), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="purchases")
    item = relationship("MarketItem", back_populates="purchases")

class ItemCode(Base):
    __tablename__ = 'item_codes'

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    code_value: Mapped[str] = mapped_column(unique=True, index=True)
    is_issued: Mapped[bool] = mapped_column(default=False)

    market_item_id: Mapped[int] = mapped_column(ForeignKey('market_items.id', ondelete="CASCADE"))
    issued_to_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete="SET NULL"))
    purchase_id: Mapped[Optional[int]] = mapped_column(ForeignKey('purchases.id', ondelete="SET NULL"))
    
    market_item = relationship("MarketItem", back_populates="codes")
    issued_to_user = relationship("User")

class Banner(Base):
    __tablename__ = "banners"
    id = Column(Integer, primary_key=True, index=True)
    image_url = Column(String, nullable=True)
    link_url = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    position = Column(String, default='feed', nullable=False)
    banner_type: Mapped[str] = mapped_column(String(50), default='image', server_default='image', nullable=False)
    data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

class RouletteWin(Base):
    __tablename__ = "roulette_wins"
    id = Column(Integer, primary_key=True, index=True)
    amount = Column(Integer, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    user = relationship("User", lazy='selectin')

class PendingUpdate(Base):
    __tablename__ = "pending_updates"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    old_data = Column(JSON, nullable=False)
    new_data = Column(JSON, nullable=False)
    status = Column(String, default='pending', nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="pending_updates")

class StatixBonusItem(Base):
    __tablename__ = "statix_bonus_items"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, server_default="Бонусы Statix", default="Бонусы Statix", nullable=False)
    description = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    is_active = Column(Boolean, server_default="true", default=True, nullable=False)
    thanks_to_statix_rate = Column(Integer, server_default="10", default=10, nullable=False)
    min_bonus_per_step = Column(Integer, server_default="100", default=100, nullable=False)
    max_bonus_per_step = Column(Integer, server_default="10000", default=10000, nullable=False)
    bonus_step = Column(Integer, server_default="100", default=100, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), default=func.now(), onupdate=func.now())

class SharedGiftInvitation(Base):
    __tablename__ = "shared_gift_invitations"
    id = Column(Integer, primary_key=True, index=True)
    buyer_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    invited_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("market_items.id"), nullable=False)
    status = Column(String, default='pending', nullable=False)
    created_at = Column(DateTime, default=func.now())
    expires_at = Column(DateTime, nullable=False)
    accepted_at = Column(DateTime, nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    
    buyer = relationship("User", foreign_keys=[buyer_id], lazy='selectin')
    invited_user = relationship("User", foreign_keys=[invited_user_id], lazy='selectin')
    item = relationship("MarketItem", lazy='selectin')

class LocalGift(Base):
    __tablename__ = "local_purchases"  # Оставляем старое название таблицы для совместимости
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("market_items.id"), nullable=False)
    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=False)
    city = Column(String, nullable=False)
    website_url = Column(String, nullable=False)
    status = Column(String, default='pending', nullable=False)
    reserved_amount = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    user = relationship("User", lazy='selectin')
    item = relationship("MarketItem", lazy='selectin')
    purchase = relationship("Purchase", lazy='selectin')

class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(String, nullable=False)
    is_read = Column(Boolean, default=False, server_default="false", nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    user = relationship("User")

class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(String, unique=True, nullable=False, index=True)
    p256dh = Column(String, nullable=False)
    auth = Column(String, nullable=False)
    user_agent = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    last_used_at = Column(DateTime, nullable=True)

    user = relationship("User")

class AndroidFcmToken(Base):
    __tablename__ = "android_fcm_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String, unique=True, nullable=False, index=True)
    device_name = Column(String(128), nullable=True)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    last_used_at = Column(DateTime, nullable=True)

    user = relationship("User")

class FeedPost(Base):
    """Новость в объединённой ленте приложения."""

    __tablename__ = "feed_posts"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=True)
    is_pinned = Column(Boolean, default=False, server_default="false", nullable=False)
    pin_order = Column(Integer, default=0, server_default="0", nullable=False)
    is_published = Column(Boolean, default=True, server_default="true", nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    published_at = Column(DateTime, server_default=func.now(), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    attachments = relationship(
        "FeedPostAttachment",
        back_populates="post",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    created_by = relationship("User", foreign_keys=[created_by_user_id])


class FeedPostAttachment(Base):
    """Вложение к новости ленты."""

    __tablename__ = "feed_post_attachments"

    id = Column(Integer, primary_key=True, index=True)
    feed_post_id = Column(Integer, ForeignKey("feed_posts.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(16), nullable=False)
    url = Column(String(1024), nullable=False)
    filename = Column(String(512), nullable=True)
    content_type = Column(String(128), nullable=True)
    sort_order = Column(Integer, default=0, server_default="0", nullable=False)

    post = relationship("FeedPost", back_populates="attachments")


class AppSettings(Base):
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, index=True)
    season_theme = Column(String, default="summer", nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
    # URL картинок интерфейса (лето/зима), JSON: { "summer": {...}, "winter": {...} }
    theme_assets = Column(JSON, nullable=True)
