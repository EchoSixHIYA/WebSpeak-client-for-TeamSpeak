<template>
  <section class="page-content skin-library-page">
    <div class="page-heading"
      ><div
        ><h2>{{ tr("skinLibrary") }}</h2
        ><p>{{ tr("skinLibraryLead") }}</p></div
      ><button
        class="primary-button"
        type="button"
        :disabled="skinBusy"
        @click="skinFileInput?.click()"
        ><span
          v-if="skinUploading"
          class="spinner small"
        ></span
        ><Icon
          v-else
          name="share"
          :size="16"
        />{{ skinUploading ? tr("skinUploading") : tr("skinUpload") }}</button
      ></div
    >
    <input
      ref="skinFileInput"
      class="skin-file-input"
      type="file"
      accept=".wskin,application/zip"
      @change="onSkinFileChanged"
    />
    <div class="alert info skin-library-scope"
      ><Icon
        name="info"
        :size="16"
      /><span>{{ tr("skinLibraryScope") }}</span></div
    >
    <section class="skin-default-control"
      ><div
        ><strong>{{ tr("skinDefault") }}</strong
        ><p>{{ tr("skinDefaultLead") }}</p></div
      ><select
        v-model="skinDefaultId"
        :disabled="skinLoading || skinBusy"
        :aria-label="tr('skinDefault')"
        @change="saveSkinDefault"
        ><option
          v-for="skin in enabledSkinEntries"
          :key="skin.id"
          :value="skin.id"
          >{{ skinName(skin) }}</option
        ></select
      ></section
    >
    <div
      v-if="skinManagerError"
      class="alert error"
      role="alert"
      >{{ skinManagerError }}</div
    >
    <div
      v-if="skinManagerNotice"
      class="alert success"
      role="status"
      >{{ skinManagerNotice }}</div
    >
    <div
      v-if="skinLoading"
      class="skin-library-loading"
      ><span class="spinner"></span>{{ tr("loading") }}</div
    >
    <div
      v-else-if="skinEntries.length"
      class="skin-library-grid"
    >
      <article
        v-for="skin in skinEntries"
        :key="skin.id"
        class="skin-library-card"
      >
        <div
          class="skin-preview"
          :class="`skin-preview--${skin.previewKind || 'custom'}`"
          ><img
            v-if="skin.previewUrl"
            :src="skin.previewUrl"
            :alt="skinName(skin)"
          /><span v-else
            ><Icon
              :name="skin.previewKind === 'discord' ? 'discord' : skin.previewKind === 'night' ? 'moon' : 'sun'"
              :size="28" /></span
          ><small>v{{ skin.version }}</small
          ><b
            v-if="skin.builtIn"
            class="skin-builtin-badge"
            >{{ tr("skinBuiltin") }}</b
          ></div
        >
        <div class="skin-library-copy"
          ><div class="skin-library-title"
            ><h3>{{ skinName(skin) }}</h3
            ><span>{{ skin.id }}</span></div
          ><p v-if="skinDescription(skin)">{{ skinDescription(skin) }}</p
          ><dl
            ><div
              ><dt>{{ tr("skinAuthor") }}</dt
              ><dd>{{ skin.author }}</dd></div
            ><div
              ><dt>{{ tr("skinLicense") }}</dt
              ><dd>{{ skin.license }}</dd></div
            ><div
              ><dt>{{ tr("skinMinVersion") }}</dt
              ><dd>{{ skin.minAppVersion }}</dd></div
            ></dl
          ><div class="skin-library-actions"
            ><a
              v-if="skin.previewUrl"
              :href="skin.previewUrl"
              target="_blank"
              rel="noreferrer"
              class="text-link"
              >{{ tr("skinPreview") }}</a
            ><label
              v-if="!skin.builtIn"
              class="skin-enabled-control"
              ><span>{{ skin.enabled === false ? tr("skinDisabled") : tr("skinEnabled") }}</span
              ><input
                type="checkbox"
                :checked="skin.enabled !== false"
                :disabled="skinBusy"
                @click.prevent="toggleSkinEnabled(skin)" /></label
            ><span
              v-else
              class="skin-protected-label"
              >{{ tr("skinProtected") }}</span
            ><button
              v-if="!skin.builtIn"
              class="text-danger"
              type="button"
              :disabled="skinBusy"
              @click="removeSkin(skin)"
              >{{ removingSkinId === skin.id ? tr("skinRemoving") : tr("skinRemove") }}</button
            ></div
          ></div
        >
      </article>
    </div>
    <div
      v-else
      class="skin-library-empty"
      ><span
        ><Icon
          name="compass"
          :size="24" /></span
      ><strong>{{ tr("skinEmpty") }}</strong
      ><p>{{ tr("skinEmptyLead") }}</p></div
    >
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import Icon from "../Icon.vue";
import type { useAdminSkins } from "../../composables/useAdminSkins.js";
import type { useAdminI18n } from "../../composables/useAdminI18n.js";
import type { SkinCatalogEntry } from "../../services/skin-catalog.js";

const props = defineProps<{
  model: ReturnType<typeof useAdminSkins>;
  i18n: Pick<ReturnType<typeof useAdminI18n>, "tr">;
}>();
const skinFileInput = ref<HTMLInputElement | null>(null);
const { skinEntries, skinLoading, skinUploading, removingSkinId, skinDefaultId, skinBusy,
  enabledSkinEntries, skinManagerError, skinManagerNotice, saveSkinDefault, toggleSkinEnabled, onSkinFileChanged, removeSkin } = props.model;
const { tr } = props.i18n;

function skinName(skin: SkinCatalogEntry): string {
  if (skin.id === "builtin.light") return tr("skinDay");
  if (skin.id === "builtin.dark") return tr("skinNight");
  if (skin.id === "community.illusia-voice") return tr("skinIllusia");
  return skin.name;
}
function skinDescription(skin: SkinCatalogEntry): string {
  if (skin.id === "builtin.light") return tr("skinDayDescription");
  if (skin.id === "builtin.dark") return tr("skinNightDescription");
  if (skin.id === "community.illusia-voice") return tr("skinIllusiaDescription");
  return skin.description || "";
}
</script>
