export interface CatalogVariationOption {
  id: number;
  attributes: Array<{ option: string }>;
}

export function coaStrengthIdentity(value: string): string {
  const normalized = value
    .toLocaleLowerCase("en")
    .replace(/[μµ]/g, "u")
    .replace(/micrograms?/g, "mcg")
    .replace(/milligrams?/g, "mg")
    .replace(/grams?/g, "g");
  const match = normalized.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(mcg|ug|mg|g)(?:\s|$)/);
  if (!match) return "";
  const unit = match[2] === "ug" ? "mcg" : match[2];
  return `${Number(match[1])}${unit}`;
}

export function variationMatchesCoaStrength(
  variation: CatalogVariationOption,
  strength: string,
): boolean {
  const expected = coaStrengthIdentity(strength);
  if (!expected) return false;
  return variation.attributes.some((attribute) => coaStrengthIdentity(attribute.option) === expected);
}

export function suggestedCoaVariationId(
  variations: CatalogVariationOption[],
  strength: string,
  storedVariationId = 0,
): number {
  if (storedVariationId > 0 && variations.some((variation) => variation.id === storedVariationId)) {
    return storedVariationId;
  }
  const matches = variations.filter((variation) => variationMatchesCoaStrength(variation, strength));
  return matches.length === 1 ? matches[0]!.id : 0;
}

export function coaNeedsExactVariation(
  productType: string,
  status: string,
  variationId: number,
): boolean {
  return productType === "variable" && status === "Available" && variationId <= 0;
}
