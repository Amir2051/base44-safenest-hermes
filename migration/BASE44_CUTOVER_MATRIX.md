# SafeNestT Base44 cutover inventory

Generated from literal references in `src/` on 2026-10-28. This is a static source inventory, not proof of runtime coverage. Imports rewritten by the Vite compatibility plugin, indirect SDK calls, and dynamically constructed function names may not be counted.

- Literal entity reference sites: **439** across **104** entity names.
- Literal `base44.functions.invoke("name", ...)` sites: **208** across **66** function names.

## Migration status

| Area | Status | Notes |
|---|---|---|
| Authentication | Partial custom API | Custom sessions/CSRF implemented in staging backend; Render Postgres still needs linking. |
| `MyCase` | Partial custom API | Owner-scoped CRUD, user case-management create/update, annual case numbers, duplicate check. No historical data import/admin parity. |
| `InvestigationCase` | Partial custom API | Owner-scoped CRUD. Service-role/admin operations are intentionally not overridden. |
| `caseManagement` | Partial | User create/update migrated; admin create-for-user, merge, recovery, redaction, and workflow actions remain unported. |
| `hermesStart` | Partial custom API | Staging hook uses custom API when `VITE_CUSTOM_BACKEND_URL` is set; Base44 fallback remains for local/legacy mode. Terminal snapshots persist in a new table. Graph/correlation and full legacy entity parity remain. |
| Evidence/file storage | Pending | Must choose/configure durable object storage before production migration. |
| Findings/reports/timeline/graph | Pending | Needs explicit data mapping and historical audit reconciliation. |
| Remaining entities/functions/integrations | Pending | Do not cut over while the UI still depends on them. |

## Entity references

| Entity | Literal references | Files | Migration status |
|---|---:|---:|---|
| `Achievement` | 3 | 2 | Pending |
| `AdminAccessLog` | 5 | 4 | Pending |
| `AdminAction` | 1 | 1 | Pending |
| `AdminScamAlert` | 2 | 1 | Pending |
| `AdminStatus` | 1 | 1 | Pending |
| `Agency` | 2 | 2 | Pending |
| `AgencyReport` | 3 | 1 | Pending |
| `AgencySubmission` | 2 | 2 | Pending |
| `Alert` | 12 | 8 | Pending |
| `ApprovalRule` | 4 | 1 | Pending |
| `AttorneyConsultation` | 4 | 4 | Pending |
| `AttorneyTask` | 2 | 1 | Pending |
| `AuditLog` | 29 | 19 | Pending |
| `AutomatedRemediation` | 3 | 2 | Pending |
| `BlockchainAlert` | 1 | 1 | Pending |
| `BlockchainTrace` | 1 | 1 | Pending |
| `BlockedThreat` | 1 | 1 | Pending |
| `BreachMonitor` | 4 | 2 | Pending |
| `CallScreeningLog` | 1 | 1 | Pending |
| `Case` | 2 | 1 | Pending |
| `CaseChat` | 2 | 1 | Pending |
| `CaseEvidenceFile` | 12 | 7 | Pending |
| `CaseEvidenceItem` | 4 | 1 | Pending |
| `CaseNote` | 3 | 2 | Pending |
| `CaseTask` | 5 | 2 | Pending |
| `CaseTimelineEvent` | 5 | 4 | Pending |
| `ChatMessage` | 5 | 3 | Pending |
| `ClientCase` | 8 | 5 | Pending |
| `CollaborationWorkspace` | 3 | 2 | Pending |
| `CollaborativeDocument` | 8 | 2 | Pending |
| `CommunicationLog` | 2 | 2 | Pending |
| `Conversation` | 3 | 1 | Pending |
| `CreditCard` | 4 | 1 | Pending |
| `CryptoTransaction` | 1 | 1 | Pending |
| `CryptoWallet` | 3 | 2 | Pending |
| `CyberFraudProfile` | 3 | 1 | Pending |
| `DeedFraudCase` | 5 | 3 | Pending |
| `DeviceProtectionLog` | 2 | 1 | Pending |
| `ElectraWallet` | 2 | 2 | Pending |
| `FamilyInvitation` | 1 | 1 | Pending |
| `FamilyLocation` | 5 | 2 | Pending |
| `FamilyVaultItem` | 3 | 1 | Pending |
| `FraudCase` | 6 | 5 | Pending |
| `GeneratedDocument` | 1 | 1 | Pending |
| `Geofence` | 4 | 2 | Pending |
| `Intelligence` | 1 | 1 | Pending |
| `InvestigationCase` | 23 | 14 | Partial custom API |
| `InvestigationLog` | 2 | 2 | Pending |
| `Investment` | 3 | 3 | Pending |
| `LegalAction` | 4 | 4 | Pending |
| `LegalDocument` | 4 | 3 | Pending |
| `LexJrConversation` | 4 | 1 | Pending |
| `LocationSettings` | 5 | 2 | Pending |
| `MasterCase` | 1 | 1 | Pending |
| `MediaContact` | 4 | 1 | Pending |
| `MediaDocument` | 2 | 1 | Pending |
| `MediaMessage` | 1 | 1 | Pending |
| `MediaProject` | 1 | 1 | Pending |
| `MediaTask` | 2 | 1 | Pending |
| `MeetingLog` | 2 | 1 | Pending |
| `MonitoringScan` | 4 | 2 | Pending |
| `MyCase` | 26 | 20 | Partial custom API |
| `Notification` | 6 | 3 | Pending |
| `Password` | 7 | 6 | Pending |
| `PhoneBlockList` | 6 | 2 | Pending |
| `PhoneIntelligence` | 1 | 1 | Pending |
| `PrivacyGuardState` | 4 | 2 | Pending |
| `PrivacyHub` | 3 | 1 | Pending |
| `Property` | 12 | 10 | Pending |
| `Query` | 1 | 1 | Pending |
| `Referral` | 11 | 7 | Pending |
| `ReferralClick` | 1 | 1 | Pending |
| `Report` | 2 | 1 | Pending |
| `ResponseTemplate` | 3 | 1 | Pending |
| `RiskAssessment` | 2 | 2 | Pending |
| `ScamDatabase` | 4 | 4 | Pending |
| `SecureCall` | 4 | 2 | Pending |
| `SecurityEvent` | 5 | 2 | Pending |
| `SecurityFinding` | 1 | 1 | Pending |
| `SecurityPolicy` | 4 | 1 | Pending |
| `SecurityScan` | 2 | 1 | Pending |
| `SupportChat` | 2 | 2 | Pending |
| `SupportMessage` | 1 | 1 | Pending |
| `SupportTicket` | 2 | 1 | Pending |
| `SystemConfig` | 12 | 5 | Pending |
| `Threat` | 1 | 1 | Pending |
| `TitleAlert` | 9 | 8 | Pending |
| `TitleAlertReport` | 1 | 1 | Pending |
| `TitleLock` | 5 | 1 | Pending |
| `Transaction` | 4 | 2 | Pending |
| `User` | 15 | 13 | Pending |
| `UserGroup` | 4 | 1 | Pending |
| `VPNConfig` | 1 | 1 | Pending |
| `VPNConnection` | 1 | 1 | Pending |
| `VPNDevice` | 1 | 1 | Pending |
| `VPNServer` | 1 | 1 | Pending |
| `VPNSession` | 8 | 2 | Pending |
| `Vault` | 1 | 1 | Pending |
| `VaultAudit` | 1 | 1 | Pending |
| `VerifiedCompany` | 6 | 5 | Pending |
| `Wallet` | 1 | 1 | Pending |
| `WalletMonitor` | 7 | 4 | Pending |
| `WebsiteCheck` | 3 | 2 | Pending |
| `WorkflowAutomation` | 1 | 1 | Pending |

## Literal function invocation references

| Function | Invocation sites | Files | Migration status |
|---|---:|---:|---|
| `adminAuth` | 1 | 1 | Pending |
| `adminCaseSearch` | 2 | 2 | Pending |
| `adminDashboardService` | 1 | 1 | Pending |
| `adminStripeSync` | 1 | 1 | Pending |
| `adminUserService` | 11 | 3 | Pending |
| `advancedInvestigation` | 3 | 2 | Pending |
| `aiCaseAnalysis` | 1 | 1 | Pending |
| `analyticsService` | 3 | 1 | Pending |
| `analyzeTransactionsAI` | 1 | 1 | Pending |
| `behaviorEngine` | 2 | 2 | Pending |
| `blockchainIntelligence` | 8 | 5 | Pending |
| `blockchainMonitor` | 1 | 1 | Pending |
| `caseDocumentService` | 1 | 1 | Pending |
| `caseFileIntake` | 2 | 1 | Pending |
| `caseManagement` | 15 | 12 | Partial custom API: user create/update only |
| `casePrioritization` | 1 | 1 | Pending |
| `caseRecovery` | 2 | 1 | Pending |
| `caseSummary` | 1 | 1 | Pending |
| `communicationAI` | 1 | 1 | Pending |
| `createMasterCase` | 1 | 1 | Pending |
| `creditService` | 5 | 1 | Pending |
| `cryptoIntelligence` | 4 | 1 | Pending |
| `cryptoInvestigation` | 2 | 2 | Pending |
| `cryptoScamDetection` | 2 | 2 | Pending |
| `electraService` | 3 | 3 | Pending |
| `emergencyDataRecovery` | 2 | 1 | Pending |
| `etherscanService` | 2 | 2 | Pending |
| `evidenceProcessing` | 8 | 4 | Pending |
| `extractCaseDetails` | 1 | 1 | Pending |
| `familyLocationService` | 3 | 2 | Pending |
| `familyService` | 5 | 5 | Pending |
| `federalCaseManager` | 4 | 2 | Pending |
| `fixCaseVisibility` | 3 | 1 | Pending |
| `fraudDetectionAI` | 2 | 2 | Pending |
| `fraudRecovery` | 3 | 2 | Pending |
| `generateCasePdf` | 4 | 4 | Pending |
| `generateCaseSummaryDoc` | 1 | 1 | Pending |
| `generateComprehensiveReport` | 1 | 1 | Pending |
| `generateCryptoReportData` | 1 | 1 | Pending |
| `generateCyberProfileDraft` | 1 | 1 | Pending |
| `generateCyberProfilePdf` | 1 | 1 | Pending |
| `getCaseKPIs` | 1 | 1 | Pending |
| `getPublicScams` | 1 | 1 | Pending |
| `hermesStart` | 1 | 1 | Partial custom API via hook when staging backend is enabled |
| `investmentEscrowService` | 2 | 2 | Pending |
| `inviteService` | 3 | 1 | Pending |
| `mediaAI` | 3 | 3 | Pending |
| `p0IncidentResponse` | 3 | 1 | Pending |
| `phoneIntelligenceOSINT` | 3 | 3 | Pending |
| `referralService` | 6 | 4 | Pending |
| `reportGeneration` | 3 | 2 | Pending |
| `securityAlertService` | 4 | 2 | Pending |
| `signalWatchService` | 7 | 5 | Pending |
| `sosFamilyService` | 3 | 2 | Pending |
| `spywareDefenseService` | 3 | 2 | Pending |
| `submitCase` | 2 | 2 | Pending |
| `subscriptionService` | 11 | 6 | Pending |
| `suggestCaseLinks` | 1 | 1 | Pending |
| `supportService` | 6 | 3 | Pending |
| `trackingService` | 3 | 2 | Pending |
| `updateUserProfile` | 3 | 3 | Pending |
| `userVerificationAI` | 1 | 1 | Pending |
| `vaultService` | 4 | 3 | Pending |
| `vpnDeviceService` | 3 | 2 | Pending |
| `vpnServerManagement` | 7 | 3 | Pending |
| `workflowAutomation` | 7 | 4 | Pending |

## Cutover rule

The frontend must not be switched to the production domain until every required entity/function in the actual runtime path has a tested custom implementation, authentication and tenant checks pass, evidence storage is durable, the 172 historical audit events are reconciled without invented owners, and rollback has been rehearsed.
