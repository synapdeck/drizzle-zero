import {defineTypeResolutionSuite} from './suites/type-resolution';
import {v0Config, v1Config} from './suites/version-config';

defineTypeResolutionSuite(v0Config);
defineTypeResolutionSuite(v1Config);
