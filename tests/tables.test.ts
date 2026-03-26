import {defineTablesSuite} from './suites/tables';
import {v0Config, v1Config} from './suites/version-config';

defineTablesSuite(v0Config);
defineTablesSuite(v1Config);
