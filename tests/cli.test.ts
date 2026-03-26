import {defineCliSuite} from './suites/cli';
import {v0Config, v1Config} from './suites/version-config';

defineCliSuite(v0Config);
defineCliSuite(v1Config);
