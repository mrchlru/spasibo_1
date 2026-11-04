# Teams Bonus ↔ «Спасибо»

**Версия контракта:** v1  
**Последнее изменение:** 2026-11-05 — API Teams `/api/spasibo/*`; в «Спасибо» карта Teams, обмен через `TEAMS_BONUS_*`.

Полное описание Excel-коннекта и API: **`Код Статикс/docs/SPASIBO_INTEGRATION.md`**.

## «Спасибо» (этот репозиторий)

- `GET /users/me/teams-bonus-card` — прокси карты (JWT пользователя).
- Покупка в магазине (`POST /market/statix-bonus/purchase`) при `TEAMS_BONUS_ENABLED=true` вызывает Teams `POST /api/spasibo/redeem` с `spasibo_user_id = users.id`.
- UI: `TeamsBonusCard`, экран «Бонусная карта», блок магазина (бывший Statix).

### Env

| Переменная | Назначение |
|------------|------------|
| `TEAMS_BONUS_ENABLED` | `true` — Teams вместо Statix API |
| `TEAMS_BONUS_BASE_URL` | Базовый URL Teams Bonus |
| `TEAMS_BONUS_API_KEY` | Заголовок `X-Spasibo-Key` (тот же, что `SPASIBO_API_KEY` на Teams) |

Перед деплоем сверяйте «Последнее изменение» в обоих `docs`.
