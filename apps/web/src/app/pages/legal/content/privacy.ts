export const PRIVACY = `
This Privacy Policy describes how **[Legal entity name]**, the operator of appmarket.org, processes personal information when you use our website, Git platform, CLI-connected features, and marketplace. It covers appmarket's processing; apps deployed into your account and external providers may have their own privacy practices.

## 1. Information we process

| Category | Examples and purpose |
| --- | --- |
| Account and sign-in | Name, email, provider account identifier, profile image, sessions, and connected devices used for authentication and account management. |
| Profile and organization | Handles, profile fields, images, organization memberships, and permissions used for collaboration and public profiles. |
| Repository and marketplace material | Code, commit metadata, READMEs, descriptions, licenses, screenshots, release files, forks, and dependency or impact information used for hosting, builds, discovery, and review. |
| Agent checkpoints | Prompts, tool calls, agent and model details, reasoning settings, token counts, and uploaded transcript content used to preserve context associated with Git commits. What is captured depends on your configuration and tool support. |
| Integrations and deployment | Connected Cloudflare account information, granted scopes, encrypted OAuth credentials, deployment configuration, status, resource identifiers, and build logs used to carry out authorized actions. Runtime logs may be retrieved from your Cloudflare account when permissions allow. |
| Transactions | App, buyer and seller identifiers, price, currency, payment and payout account references, and payment, refund, or dispute status used to deliver purchases and administer marketplace payments. |
| Activity and security | Request metadata, IP information, device or browser signals, token issuance and access records, operational logs, errors, and moderation access records used for security, rate limiting, troubleshooting, and accountability. |
| Reports and communications | Reports, moderation notes, optional contact details, and support requests used to investigate issues and respond. |

Do not put secrets or other people's personal information in repositories, prompts, transcripts, release files, or reports unless you have the right and a valid reason to provide it. These materials can contain personal information even when they primarily concern code.

## 2. How we use information

We use information to authenticate users, host and build code, record agent context, manage organizations, publish and discover apps, process purchases, deploy into authorized accounts, investigate reports, prevent abuse, and meet legal obligations. We also use operational information to diagnose failures and improve reliability.

Where a legal basis is required, processing may rely on performing our agreement with you, legitimate interests such as security and service operation, compliance with law, or consent where required. A connection to an external provider can be withdrawn through the available connection controls and that provider's settings.

## 3. Public and private material

Profile information you make public and published app information may be visible to visitors and search engines. Access to source and release files depends on publication, price, license, and access permissions. Other users may retain copies that they were entitled to obtain.

Repositories start private. Organization permissions determine which members can access shared work. Checkpoints are private by default and have their own visibility controls; publishing a repository does not automatically publish private checkpoint prompts. Authorized moderators may access checkpoint material when investigating a report, and moderator checkpoint access is recorded for the repository owner.

Local CLI redaction checks can remove recognized secrets before upload, but cannot detect every sensitive value. Review records and visibility settings before sharing them.

## 4. Providers and disclosures

We disclose information as needed to operate the Service and fulfill authorized requests:

- **Cloudflare** provides hosting, storage, build and deployment infrastructure, bot protection, and operational observability. Deploying into your connected account sends the code and configuration needed for that deployment to Cloudflare.
- **Google or GitHub** provides authentication when you choose that provider. Its own privacy policy covers its processing.
- **Stripe** processes purchases, payout onboarding, payment disputes, and refunds. Stripe collects payment credentials and payout verification information through its interfaces. appmarket stores transaction and connected-account references, rather than your full card details or payout bank credentials.
- **Integrations you configure** can receive the data needed for their function. For example, a repository webhook sends event information and a short-lived clone token to the endpoint you choose.
- **Other authorized users** receive information according to repository, organization, checkpoint, and marketplace permissions.

We may also disclose information when required by law, to address fraud or security threats, to enforce our terms, or in a business transfer subject to applicable privacy obligations. We do not sell personal information or use advertising trackers on the Service. Information you supply directly to a coding agent or model provider is also subject to that provider's policy; appmarket's policy does not control that provider's use.

## 5. Cookies and browser resources

We use authentication cookies and related session mechanisms to keep you signed in and protect account flows. Cloudflare Turnstile may process browser and device signals for bot protection. Browser controls can restrict cookies, but sign-in or security features may stop working. Fonts and other resources requested by your browser may be delivered by external providers, including Google Fonts, which receive the network information needed to serve those requests.

## 6. Security

We use access controls, short-lived Git credentials, encryption for stored Cloudflare OAuth credentials, and log-redaction measures. Security measures cannot guarantee that data will never be lost, accessed improperly, or disclosed. Notify **[security contact email]** if you suspect a compromise, and rotate exposed credentials at their issuing provider.

## 7. Retention and deletion

We retain information for the purpose for which it was collected, including providing ongoing account and repository features, maintaining transaction records, responding to disputes, and meeting legal or security obligations. Different categories have different retention requirements; **[account, transaction, backup, and security retention schedule to be confirmed]**.

Repository checkpoint records and associated uploaded transcripts are scheduled for deletion after their repository is removed. This does not mean every account record, payment record, log, backup, or externally distributed copy is immediately deleted. Operational log retention also depends on the hosting provider's configuration. Request account or data deletion at **[privacy contact email]**; we may verify your identity and explain any lawful reason to retain particular records.

## 8. Your choices and rights

You can edit available profile fields, choose checkpoint visibility, manage organization access, revoke tokens, disconnect Cloudflare, and use available repository or checkpoint exports. Disconnecting Cloudflare does not itself remove resources already deployed into your account.

Depending on your location, you may have rights to access, correct, delete, receive a portable copy of, restrict, or object to processing of personal information, or withdraw consent where processing relies on it. Contact **[privacy contact email]** to make a request. We respond within applicable legal deadlines. You may also complain to your local data-protection authority. These rights can be subject to lawful exceptions and identity verification.

## 9. International processing and children

Our providers may process information in countries other than yours. Where required, we use the safeguards applicable to those transfers. **[Operator location and applicable international-transfer arrangements to be confirmed.]**

The Service is intended for adults and is not directed to children under 13. If you believe a child has provided personal information, contact us so we can investigate and take appropriate action.

## 10. Updates and contact

We will show the date of revisions and communicate material changes where required.

**Privacy operator:** [Legal entity name]

**Address:** [business address]

**Privacy requests:** [privacy contact email]

**Security reports:** [security contact email]
`;
