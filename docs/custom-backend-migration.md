# SafeNestT Custom Backend Migration

## Source application

- GitHub: Amir2051/base44-safenest-hermes
- Original product: Base44-connected SafeNestT application

## Investigation system

- GitHub: Amir2051/safenestt-ai-agency
- Role: standalone fraud/scam investigation system and Hermes engine

## Migration rule

The Base44 application remains untouched while the custom backend is built in parallel.

No Base44 dependency is removed until the replacement path has passed feature, security, data-integrity, and end-to-end tests.

## Target

```
SafeNestT frontend
      |
      v
Custom SafeNestT API
      |
      +--> PostgreSQL + database authorization
      +--> Object/file storage
      +--> Auth
      +--> Billing/integrations
      |
      v
SafeNestT AI Agency / Hermes
```

## Security requirement

Case ownership and tenant isolation must be enforced server-side and at the database layer. Frontend filtering is never the security boundary.

## Current status

- [x] Isolated migration branch created
- [x] Custom API skeleton created
- [x] Health endpoint created
- [x] Configuration foundation created
- [ ] Database layer
- [ ] Authentication
- [ ] Users/roles/tenants
- [ ] Cases + RLS
- [ ] Evidence/storage
- [ ] Hermes integration
- [ ] Data migration
- [ ] Cutover
- [ ] Base44 removal
