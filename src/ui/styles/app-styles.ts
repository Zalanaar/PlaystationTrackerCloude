// Стили экранов приложения (Фаза 47). Корневой layout держит только базу (токены, темы, base, Tailwind),
// чтобы /login не тянул ~200 КБ CSS коллекции/статистики. Подключать во всех маршрутах, кроме /login.
// Порядок важен (как был в корневом layout); классы файлов общие между экранами — дробить по маршрутам нельзя.
// П15.4: большие файлы разрезаны по разделам (стыки — на верхнем уровне, порядок правил прежний). Стили, которые нужны
// только одному блоку, подключает сам компонент: stats-rare.css (RareTrophies), stats-tables.css (ChartTable).
import './collection.css';
import './collection-hero.css';
import './collection-near.css';
import './chronicle.css';
import './skeletons.css';
import './game-dialog.css';
import './game-dialog-extras.css';
import './game-history.css';
import './triage.css';
import './stats.css';
import './stats-activity.css';
import './stats-alltime.css';
import './profile.css';
import './plan.css';
import './access.css';
import './health.css';
import './onboarding.css';
import './tour.css';
import './inbox.css';
import './install.css';
import './profiles.css';
import './manual.css';
import './manual-buy.css';
import './manual-confirm.css';
import './trophies.css';
import './goals.css';
import './hunts.css';
import './diary.css';
import './app-tail.css'; // последним: каскад как до разделения (Tailwind после стилей экранов)
