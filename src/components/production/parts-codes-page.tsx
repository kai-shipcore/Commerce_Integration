"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { MasterDataTab, type MasterDataTabConfig } from "@/components/production/master-data-tab";
import { PartRegistrationTab } from "@/components/production/part-registration-tab";

const TABS: { key: string; labelKo: string; labelEn: string }[] = [
  { key: "parts", labelKo: "Part", labelEn: "Part" },
  { key: "codes", labelKo: "Code", labelEn: "Code" },
  { key: "designer-initials", labelKo: "Designer Initial", labelEn: "Designer Initial" },
];

const MASTER_DATA_CONFIGS: Record<string, MasterDataTabConfig> = {
  codes: {
    apiPath: "/api/production/codes",
    permissionSection: "parts-codes",
    codeField: "code",
    hasDescription: true,
    uppercaseCode: true,
    icon: "🏷️",
    codeLabel: { ko: "Code", en: "Code" },
    codePlaceholder: "CODE-001",
    entityLabel: { ko: "Code", en: "Code" },
    checkDuplicateOnType: true,
  },
  "designer-initials": {
    apiPath: "/api/production/designer-initials",
    permissionSection: "parts-codes",
    codeField: "initial",
    nameField: "designerName",
    hasDescription: false,
    uppercaseCode: true,
    icon: "🖊️",
    codeLabel: { ko: "Initial", en: "Initial" },
    namePlaceholder: { ko: "디자이너 이름 (Designer Name)", en: "Designer Name" },
    codePlaceholder: "TK",
    entityLabel: { ko: "Designer Initial", en: "Designer Initial" },
  },
};

export function PartsCodesPage() {
  const { pick } = useI18n();
  const [activeTab, setActiveTab] = useState(TABS[0].key);

  return (
    <section className="flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-6 py-4">
        <div className="flex items-start gap-2">
          <Package className="mt-1 h-5 w-5" />
          <div>
            <h1 className="text-lg font-semibold">{pick("Parts & Codes 관리", "Parts & Codes Management")}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {pick("생산에서 사용하는 Part, Code, Designer Initial 마스터 데이터를 관리합니다", "Manage Production master data for Parts, Codes, and Designer Initials")}
            </p>
          </div>
        </div>
      </header>

      <div className="flex gap-1 border-b border-[#e2dfd8] bg-white px-6 pt-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "border-b-2 border-[#1a5cdb] text-[#1a4db0]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {pick(tab.labelKo, tab.labelEn)}
          </button>
        ))}
      </div>

      {activeTab === "parts" ? (
        <PartRegistrationTab key={activeTab} />
      ) : (
        <MasterDataTab key={activeTab} config={MASTER_DATA_CONFIGS[activeTab]} />
      )}
    </section>
  );
}
