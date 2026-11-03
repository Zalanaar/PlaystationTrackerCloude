// Стили экранов приложения (Фаза 47). Корневой layout держит только базу (токены, темы, base, Tailwind),
// чтобы /login не тянул ~200 КБ CSS коллекции/статистики. Подключать во всех маршрутах, кроме /login.
// Порядок важен (как был в корневом layout); классы файлов общие между экранами — дробить по маршрутам нельзя.
import './collection.css';
import './chronicle.css';
import './skeletons.css';
import './game-dialog.css';
import './game-history.css';
import './triage.css';
import './stats.css';
import './profile.css';
import './plan.css';
import './access.css';
import './health.css';
import './onboarding.css';
import './tour.css';
import './inbox.css';
import './telegram.css';
import './install.css';
import './profiles.css';
import './manual.css';
import './trophies.css';
import './app-tail.css'; // последним: каскад как до разделения (Tailwind после стилей экранов)
