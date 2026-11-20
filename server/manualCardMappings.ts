export {
  type ManualWikiMappingEntry as ManualCardMapping,
  type ManualMappingLookupQuery as ManualMappingQuery,
  MANUAL_WIKI_MAPPINGS as MANUAL_CARD_MAPPINGS,
  registerManualWikiMapping,
  unregisterManualWikiMapping,
  listManualWikiMappings as listManualCardMappings,
  getManualWikiMapping as findManualCardMapping,
  validateManualWikiMappingEntry,
  isValidManualArtworkUrl,
  isValidManualWikiTitle,
  isValidManualFileName,
} from '../src/utils/ManualWikiMapping.ts';

import { registerManualWikiMapping, type ManualWikiMappingEntry } from '../src/utils/ManualWikiMapping.ts';

export function upsertManualCardMapping(mapping: ManualWikiMappingEntry): void {
  registerManualWikiMapping(mapping);
}
