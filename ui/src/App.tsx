import { Toast } from './components/Toast';
import { MainScreen } from './screens/MainScreen';

export default function App(): JSX.Element {
  return (
    <>
      <MainScreen />
      <Toast />
    </>
  );
}
