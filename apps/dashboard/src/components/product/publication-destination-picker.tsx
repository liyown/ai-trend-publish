import type {
  ChannelAccount,
  ChannelDefinition,
  PublicationDestinationSelection,
  PublicationTypeProfileDefinition,
} from "#platform/api/types.ts";
import { cn } from "#lib/utils.ts";

export function PublicationDestinationPicker({
  accounts,
  channels,
  profiles,
  value,
  onChange,
}: {
  accounts: ChannelAccount[];
  channels: ChannelDefinition[];
  profiles: PublicationTypeProfileDefinition[];
  value: PublicationDestinationSelection[];
  onChange(value: PublicationDestinationSelection[]): void;
}) {
  const enabledAccounts = accounts.filter((account) => account.enabled !== false);
  if (!enabledAccounts.length) {
    return (
      <div className="border-y border-[var(--border)] py-6 text-sm text-[var(--muted-strong)]">
        还没有可用发布账号。请先在“发布账号”中完成渠道账号配置。
      </div>
    );
  }
  return (
    <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
      {channels.map((channel) => {
        const channelAccounts = enabledAccounts.filter((account) => account.channel === channel.id);
        if (!channelAccounts.length) return null;
        const channelProfiles = profiles.filter((profile) => profile.channel === channel.id);
        return (
          <section key={channel.id} className="py-4">
            <div className="mb-2 px-1">
              <h4 className="text-sm font-semibold">{channel.name}</h4>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{channel.description}</p>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {channelAccounts.map((account) => {
                const selected = value.filter((item) => item.accountId === account.id);
                const checked = selected.length > 0;
                return (
                  <div key={account.id} className="grid gap-2 px-1 py-3 sm:grid-cols-[1fr_auto]">
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          onChange(
                            checked
                              ? value.filter((item) => item.accountId !== account.id)
                              : [
                                  ...value,
                                  {
                                    accountId: account.id,
                                    publicationType: channel.defaultPublicationType,
                                  },
                                ],
                          )
                        }
                      />
                      <span>
                        <strong className="block text-sm font-medium">{account.name}</strong>
                        <span className="mt-0.5 block text-xs text-[var(--muted)]">
                          {account.connectorId ?? "渠道连接"}
                        </span>
                      </span>
                    </label>
                    {checked ? (
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        {channelProfiles.map((profile) => {
                          const profileChecked = selected.some(
                            (item) => item.publicationType === profile.type,
                          );
                          return (
                            <label
                              key={profile.type}
                              className={cn(
                                "flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1.5 text-xs",
                                profileChecked
                                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                                  : "border-[var(--border)]",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={profileChecked}
                                onChange={() => {
                                  const other = value.filter(
                                    (item) =>
                                      item.accountId !== account.id ||
                                      item.publicationType !== profile.type,
                                  );
                                  onChange(
                                    profileChecked
                                      ? selected.length === 1
                                        ? value
                                        : other
                                      : [
                                          ...value,
                                          {
                                            accountId: account.id,
                                            publicationType: profile.type,
                                          },
                                        ],
                                  );
                                }}
                              />
                              {profile.name}
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
