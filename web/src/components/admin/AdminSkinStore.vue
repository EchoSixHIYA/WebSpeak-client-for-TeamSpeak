<template>
  <section class="skin-store" :aria-label="tr('skinStore')" :aria-busy="storeLoading">
    <div class="skin-store-heading">
      <div><h3>{{ tr('skinStore') }}</h3><p>{{ tr('skinStoreLead') }}</p></div>
      <button class="secondary-button" type="button" :disabled="storeLoading || skinBusy" @click="loadSkinStore(true)">
        {{ storeLoading ? tr('loading') : tr('skinStoreRefresh') }}
      </button>
    </div>
    <p class="skin-store-source">{{ tr('skinStoreSource') }} · <a :href="SKIN_STORE_REPOSITORY" target="_blank" rel="noopener noreferrer">Huddle-Up-Forge/webspeak-skins</a></p>
    <div class="alert info"><Icon name="info" :size="16"/><span>{{ tr('skinStorePermissionNote') }}</span></div>
    <div v-if="storeError" class="alert error" role="alert">{{ storeError }}</div>
    <div v-if="storeLoading" class="skin-library-loading" role="status"><span class="spinner"></span>{{ tr('loading') }}</div>
    <div v-if="storeCatalog?.entries.length" class="skin-library-grid">
      <article v-for="entry in storeCatalog.entries" :key="entry.id" class="skin-library-card skin-store-card">
        <div class="skin-library-copy">
          <div class="skin-library-title"><h3>{{ entry.metadata?.name || entry.id }}</h3><span>{{ entry.id }}</span></div>
          <template v-if="entry.metadata">
            <p>{{ entry.metadata.description }}</p>
            <dl>
              <div><dt>{{ tr('skinStoreAvailableVersion') }}</dt><dd>v{{ entry.metadata.version }}</dd></div>
              <div v-if="installedStoreSkin(entry)"><dt>{{ tr('skinStoreCurrentVersion') }}</dt><dd>v{{ installedStoreSkin(entry)!.version }}</dd></div>
              <div><dt>{{ tr('skinAuthor') }}</dt><dd>{{ entry.metadata.author }}</dd></div>
              <div><dt>{{ tr('skinLicense') }}</dt><dd>{{ entry.metadata.license }}</dd></div>
              <div><dt>{{ tr('skinMinVersion') }}</dt><dd>{{ entry.metadata.minAppVersion }}</dd></div>
            </dl>
            <p v-if="!entry.compatible" class="skin-store-warning">{{ tr('skinStoreIncompatible') }}</p>
          </template>
          <p v-else class="skin-store-warning">{{ tr(entry.error === 'SKIN_STORE_UNAVAILABLE' ? 'skinStoreUnavailable' : 'skinStoreInvalid') }}</p>
          <div class="skin-library-actions">
            <a :href="entry.repository" target="_blank" rel="noopener noreferrer" class="text-link">{{ tr('skinStoreRepository') }}</a>
            <button v-if="entry.metadata" class="primary-button" type="button"
              :disabled="skinBusy || skinLoading || storeLoading || !entry.compatible || storeVersionOrder(entry) <= 0"
              @click="installStoreSkin(entry)">
              <span v-if="storeInstallingId === entry.id" class="spinner small"></span>
              {{ storeInstallingId === entry.id ? tr('skinStoreInstalling') : storeVersionOrder(entry) < 0 ? tr('skinStoreNewer') : storeVersionOrder(entry) === 0 ? tr('skinStoreInstalled') : installedStoreSkin(entry) ? tr('skinStoreUpdate') : tr('skinStoreInstall') }}
            </button>
          </div>
        </div>
      </article>
    </div>
    <p v-else-if="storeCatalog && !storeLoading" class="skin-library-empty">{{ tr('skinStoreEmpty') }}</p>
    <p v-if="storeCatalog" class="skin-store-source">{{ tr('skinStoreLoadedAt') }} {{ new Date(storeCatalog.fetchedAt).toLocaleString() }} · WebSpeak {{ storeCatalog.appVersion }}</p>
  </section>
</template>

<script setup lang="ts">
import Icon from "../Icon.vue";
import { SKIN_STORE_REPOSITORY } from "../../../../src/shared/skin-store.js";
import type { useAdminSkins } from "../../composables/useAdminSkins.js";
import type { useAdminI18n } from "../../composables/useAdminI18n.js";
const props = defineProps<{ model: ReturnType<typeof useAdminSkins>; i18n: Pick<ReturnType<typeof useAdminI18n>, "tr"> }>();
const { storeCatalog, storeLoading, storeInstallingId, storeError, skinBusy, skinLoading,
  loadSkinStore, installStoreSkin, installedStoreSkin, storeVersionOrder } = props.model;
const { tr } = props.i18n;
</script>
