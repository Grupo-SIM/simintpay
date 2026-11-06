export type PlatformOwnership = {
  ownerUserId?: string;
  owner?: { id: string; name?: string | null; email?: string | null } | null;
};

export function platformOwnerLabel(
  platform: PlatformOwnership,
  user: { id: string } | null,
) {
  const id = platform.ownerUserId ?? platform.owner?.id;
  if (id && id === user?.id) return 'Admin (você)';
  const owner = platform.owner;
  const identity = owner?.name;
  return identity
    ? `Usuário: ${identity}`
    : 'Nome do proprietário indisponível';
}

export function adminPlatformLabel(
  platform: PlatformOwnership & { name: string; isActive: boolean },
  _user: { id: string; isAdmin: boolean } | null,
) {
  return `${platform.name}${platform.isActive ? '' : ' (Inativa)'}`;
}

export type ProductPlatform = PlatformOwnership & {
  tag: string;
  name: string;
  ownerUserId: string;
  isActive: boolean;
};

export function productPlatformOptions(
  platforms: ProductPlatform[],
  user: { id: string; isAdmin: boolean } | null,
) {
  if (!user) return [];
  return platforms
    .filter(
      (platform) =>
        user.isAdmin || (platform.ownerUserId === user.id && platform.isActive),
    )
    .map((platform) => ({
      value: platform.tag,
      label: adminPlatformLabel(platform, user),
      ...(user.isAdmin
        ? {
            selectedLabel: `${platform.name}${platform.isActive ? '' : ' (Inativa)'}`,
          }
        : {}),
      disabled: !platform.isActive,
    }));
}
