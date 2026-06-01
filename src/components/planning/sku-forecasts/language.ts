export type SkuForecastLanguage = "ko" | "en";

export function pick(language: SkuForecastLanguage, ko: string, en: string): string {
  return language === "ko" ? ko : en;
}

export function productLabel(language: SkuForecastLanguage, key: "fm" | "cc" | "sc"): string {
  if (language === "en") return { fm: "Floor Mat", cc: "Car Cover", sc: "Seat Cover" }[key];
  return { fm: "플로어 매트", cc: "카 커버", sc: "시트 커버" }[key];
}
