-- #104: Better Auth device authorization (RFC 8628) for CLIs and agents. Generated with
-- `auth generate` from src/auth/options.ts; pending codes expire after 10 minutes.
create table "deviceCode" ("id" text not null primary key, "deviceCode" text not null, "userCode" text not null, "userId" text, "expiresAt" date not null, "status" text not null, "lastPolledAt" date, "pollingInterval" integer, "clientId" text, "scope" text);

create unique index "deviceCode_deviceCode_uidx" on "deviceCode" ("deviceCode");

create unique index "deviceCode_userCode_uidx" on "deviceCode" ("userCode");
