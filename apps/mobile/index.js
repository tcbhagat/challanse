/**
 * @format
 */

import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { startReceiptBackgroundSync } from './src/sync/receiptBackgroundSync';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask('ChallanSeBootSync', () => async () => {
  await startReceiptBackgroundSync();
});
