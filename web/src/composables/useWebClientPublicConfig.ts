import { computed, reactive, ref, type Ref } from "vue";
import { splitTeamSpeakTarget } from "../services/teamspeak-target.js";
import type { Language } from "../i18n/web-client.js";

interface RelayOption {
  id: string;
  name: string;
}

type Translator = (key: string, variables?: Record<string, string | number>) => string;

interface UseWebClientPublicConfigOptions {
  serverHost: Ref<string>;
  serverPort: Ref<string>;
  accelerationRelayId: Ref<string>;
  language: Ref<Language>;
  t: Translator;
}

export function useWebClientPublicConfig({
  serverHost,
  serverPort,
  accelerationRelayId,
  language,
  t,
}: UseWebClientPublicConfigOptions) {
  const accessMode = ref<"fixed" | "open">("fixed");
  const initialized = ref(false);
  const siteName = ref("WebSpeak");
  const appVersion = ref("0.2.5-preview");
  const visitorNumber = ref<number | null>(null);
  const visitorTotal = ref<number | null>(null);
  const accelerationRelays = ref<RelayOption[]>([]);
  const serverConfigLoading = ref(true);
  const welcomeTexts = reactive<Record<Language, string>>({ zh: "", en: "", de: "", ru: "", ja: "" });
  const accelerationAvailable = computed(() => accelerationRelays.value.length > 0);
  const localizedWelcomeText = computed(() => welcomeTexts[language.value] || t("joinDescription"));

  async function loadPublicConfig(): Promise<void> {
    const query = new URLSearchParams(location.search);
    try {
      const response = await fetch("/api/public-config", { headers: { accept: "application/json" } });
      if (!response.ok) return;
      const config = await response.json() as {
        version?: unknown;
        initialized?: unknown;
        siteName?: unknown;
        welcomeText?: unknown;
        welcomeTextEn?: unknown;
        welcomeTexts?: unknown;
        accessMode?: unknown;
        target?: unknown;
        visitorNumber?: unknown;
        visitorTotal?: unknown;
        accelerationRelays?: unknown;
      };
      if (typeof config.version === "string" && config.version.trim()) appVersion.value = config.version.trim();
      visitorNumber.value = Number.isSafeInteger(config.visitorNumber) && Number(config.visitorNumber) > 0 ? Number(config.visitorNumber) : null;
      visitorTotal.value = Number.isSafeInteger(config.visitorTotal) && Number(config.visitorTotal) > 0 ? Number(config.visitorTotal) : null;
      initialized.value = config.initialized === true;
      if (typeof config.siteName === "string" && config.siteName.trim()) siteName.value = config.siteName.trim();
      if (typeof config.welcomeText === "string") welcomeTexts.zh = config.welcomeText;
      if (typeof config.welcomeTextEn === "string") welcomeTexts.en = config.welcomeTextEn;
      if (config.welcomeTexts && typeof config.welcomeTexts === "object" && !Array.isArray(config.welcomeTexts)) {
        const configuredTexts = config.welcomeTexts as Record<string, unknown>;
        for (const languageCode of ["zh", "en", "de", "ru", "ja"] as const) {
          const text = configuredTexts[languageCode];
          if (typeof text === "string") welcomeTexts[languageCode] = text;
        }
      }
      accessMode.value = config.accessMode === "open" ? "open" : "fixed";
      accelerationRelays.value = Array.isArray(config.accelerationRelays)
        ? config.accelerationRelays.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const relay = value as { id?: unknown; name?: unknown };
          return typeof relay.id === "string" && typeof relay.name === "string" && relay.id && relay.name
            ? [{ id: relay.id, name: relay.name }]
            : [];
        })
        : [];
      if (!accelerationAvailable.value || !accelerationRelays.value.some((relay) => relay.id === accelerationRelayId.value)) accelerationRelayId.value = "";
      const hasInviteTarget = query.has("server") || query.has("target") || query.has("tsHost") || query.has("tsPort");
      if (!hasInviteTarget && typeof config.target === "string" && config.target.trim()) {
        const target = splitTeamSpeakTarget(config.target);
        serverHost.value = target.address;
        serverPort.value = target.port;
      }
    } catch {
      // Keep joining disabled until the gateway confirms its initialized policy.
    } finally {
      serverConfigLoading.value = false;
    }
  }

  return {
    accessMode,
    initialized,
    siteName,
    appVersion,
    visitorNumber,
    visitorTotal,
    accelerationRelays,
    accelerationAvailable,
    serverConfigLoading,
    localizedWelcomeText,
    loadPublicConfig,
  };
}
