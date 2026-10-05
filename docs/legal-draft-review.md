# Legal document review

The four `/legal/*` pages are drafts, not yet in effect. They describe the implemented Git, checkpoint, deployment, and marketplace features as of October 5, 2026. They do not establish that the operator has completed legal review or regulatory requirements.

Before adopting the documents, confirm and replace the bracketed fields:

- Operating legal entity, business address, and operator location.
- Support, payment, privacy, security, legal, and copyright notice contacts.
- Governing law, court or dispute process, and liability allocation/cap.
- Account, transaction, backup, and security retention schedules.
- Applicable international data-transfer arrangements.
- Copyright designated-agent details and any required registration.
- Any additional publisher indemnity or liability terms.

Review the documents against actual production configuration and business obligations. In particular, validate provider disclosures, data access and deletion practices, payment fees, refund handling, tax responsibilities, and buyer access after withdrawal. Decide an effective date and how users will receive notice or accept agreements where needed; this change does not add an acceptance flow.

## Implementation references

- `apps/api/src/payments/routes.ts`: one-time payments, 10% application fee, refund transfer/fee reversal, purchase access status.
- `apps/api/src/checkpoints/store.ts`: checkpoint access and removed-repository cleanup.
- `apps/api/src/cloudflare/crypto.ts`: stored Cloudflare credential encryption.
- `docs/observability.md`: operational logging and provider configuration.

## Primary guidance consulted

- [FTC consumer privacy guidance](https://www.ftc.gov/business-guidance/privacy-security/consumer-privacy): privacy representations must reflect actual practices.
- [U.S. Copyright Office Section 512 guidance](https://www.copyright.gov/512/) and [designated-agent directory](https://www.copyright.gov/dmca-directory/): notice procedures and designated-agent requirements require separate operator action.
- [Stripe refunded-payment fees](https://support.stripe.com/questions/understanding-fees-for-refunded-payments): provider fee treatment may differ from the platform's application-fee reversal.
- [Stripe Connected Account Agreement](https://stripe.com/legal/connect-account): separate provider terms apply to payout accounts.
