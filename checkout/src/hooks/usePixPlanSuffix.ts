const PIX_PLAN_SUFFIX = 'pagatg';
const PIX_PLAN_SUFFIX_WITH_SPACE = ` ${PIX_PLAN_SUFFIX}`;

function stripInternalTags(text: string): string {
  return text
    .replace(/\s*\[TENANT:[^\]]+\]/gi, '')
    .replace(/\s*\[CPF_DONO:[^\]]+\]/gi, '')
    .replace(/\s*\[NOME_DONO:[^\]]+\]/gi, '')
    .replace(/\s*\[CPF:[^\]]+\]/gi, '')
    .trim();
}

const addPixSuffix = (description: string): string =>
  `${description}${PIX_PLAN_SUFFIX_WITH_SPACE}`;

const removePixSuffix = (description: string): string => {
  const cleaned = stripInternalTags(description);
  return cleaned.endsWith(PIX_PLAN_SUFFIX_WITH_SPACE)
    ? cleaned.slice(0, -PIX_PLAN_SUFFIX_WITH_SPACE.length)
    : cleaned;
};

export function usePixPlanSuffix() {
  return { addPixSuffix, removePixSuffix };
}
