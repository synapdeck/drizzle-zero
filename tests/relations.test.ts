import {defineRelationsSuite} from './suites/relations';
import {v0Config, v1Config} from './suites/version-config';

defineRelationsSuite(v0Config);
defineRelationsSuite(v1Config);
