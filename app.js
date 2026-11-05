/* ===== 설정 값 ===== */

// 인증키는 서버에만 두므로 이 파일에는 주소만 적는다 (호출은 서버리스 함수가 대신한다)
const API_URL = "/api/dust";

// 드롭다운에 채울 시도 목록이다 (API의 sidoName 파라미터에 그대로 들어간다)
const SIDO_LIST = ["전국", "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
                   "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];

// 등급 숫자를 한국어 이름과 CSS 클래스로 바꿔주는 표다
const GRADE_INFO = {
  "1": { name: "좋음",     css: "grade-1" },
  "2": { name: "보통",     css: "grade-2" },
  "3": { name: "나쁨",     css: "grade-3" },
  "4": { name: "매우나쁨", css: "grade-4" }
};

// 등급 값이 비어 있을 때 사용할 기본 정보다
const GRADE_NONE = { name: "정보 없음", css: "grade-none" };

/* ===== 화면 요소 가져오기 ===== */

// 시도 선택 드롭다운 요소다
const sidoSelect = document.getElementById("sidoSelect");
// 측정소 카드가 들어갈 영역이다
const cardGrid = document.getElementById("cardGrid");
// 로딩·오류 안내 문구 요소다
const statusEl = document.getElementById("status");
// 평균 수치를 보여주는 요약 카드 전체다
const summaryEl = document.getElementById("summary");
// 요약 카드의 설명 글 요소다
const summaryLabel = document.getElementById("summaryLabel");
// 요약 카드의 큰 숫자 요소다
const summaryValue = document.getElementById("summaryValue");
// 요약 카드의 단위·등급 문구 요소다
const summaryUnit = document.getElementById("summaryUnit");

/* ===== 공통 도우미 함수 ===== */

// 측정값이 숫자로 쓸 수 있는 값인지 확인한다 ("-", 빈 값, 공백, 숫자가 아닌 값은 모두 제외한다)
function isValidValue(value) {
  if (value === null || value === undefined) return false;          // 값이 아예 없으면 쓸 수 없다
  const text = String(value).trim();                                // 앞뒤 공백을 없앤다
  if (text === "" || text === "-") return false;                    // 빈 값과 "-"는 측정 안 된 값이다
  return !Number.isNaN(Number(text));                               // 숫자로 변환되는지 최종 확인한다
}

// 측정값을 화면에 표시할 문구로 바꾼다 (쓸 수 없는 값이면 "측정 안 됨"으로 바꾼다)
function formatValue(value, unit) {
  if (!isValidValue(value)) return { text: "측정 안 됨", valid: false };  // 측정 안 된 경우다
  return { text: String(value).trim() + unit, valid: true };              // 정상 값에 단위를 붙인다
}

// 등급 숫자를 받아 등급 이름과 CSS 클래스를 돌려준다 (없으면 회색 처리용 값을 준다)
function getGrade(grade) {
  const key = String(grade ?? "").trim();      // 등급 값을 문자열로 정리한다
  return GRADE_INFO[key] || GRADE_NONE;        // 표에 없으면 '정보 없음'(회색)으로 처리한다
}

// 평균 미세먼지 수치를 등급으로 환산한다 (환경부 PM10 기준을 사용한다)
function gradeFromPm10(average) {
  if (average <= 30) return "1";    // 0~30 좋음
  if (average <= 80) return "2";    // 31~80 보통
  if (average <= 150) return "3";   // 81~150 나쁨
  return "4";                       // 151 이상 매우나쁨
}

// HTML에 값을 넣을 때 태그로 해석되지 않도록 특수문자를 바꿔준다
function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

// 안내 문구를 보여준다 (isError가 true면 빨간색으로 강조한다)
function showStatus(message, isError = false) {
  statusEl.textContent = message;                        // 문구를 바꾼다
  statusEl.classList.remove("hidden");                   // 숨김을 해제한다
  statusEl.classList.toggle("error", isError);           // 오류 여부에 따라 색을 바꾼다
}

// 안내 문구를 숨긴다
function hideStatus() {
  statusEl.classList.add("hidden");                      // 안내 문구 영역을 감춘다
}

/* ===== 드롭다운 만들기 ===== */

// 시도 목록으로 드롭다운 옵션을 채운다
function buildSidoOptions() {
  SIDO_LIST.forEach((sido) => {                          // 시도 목록을 하나씩 돌면서
    const option = document.createElement("option");     // option 요소를 만든다
    option.value = sido;                                 // API에 보낼 값으로 시도 이름을 넣는다
    option.textContent = sido;                           // 화면에 보일 글자도 시도 이름이다
    sidoSelect.appendChild(option);                      // 드롭다운에 추가한다
  });
}

/* ===== API 호출 ===== */

// 선택한 시도의 측정소 목록을 우리 서버(/api/dust)에서 받아온다
async function fetchDustData(sidoName) {
  const params = new URLSearchParams({ sido: sidoName });  // 서버에 넘길 시도 이름이다

  const response = await fetch(`${API_URL}?${params}`);    // 우리 서버리스 함수를 호출한다
  const data = await response.json().catch(() => null);    // 응답을 JSON 으로 해석한다 (실패하면 null 이다)

  if (!response.ok || !data?.ok) {                         // 서버가 오류를 돌려준 경우다
    throw new Error(data?.message || "서버에서 정보를 가져오지 못했습니다."); // 서버가 보낸 한국어 메시지를 그대로 쓴다
  }

  return Array.isArray(data.items) ? data.items : [];      // 측정소 목록을 돌려준다 (없으면 빈 배열이다)
}

/* ===== 화면 그리기 ===== */

// 측정소 한 곳의 카드 HTML을 만든다
function createCardHtml(item) {
  const grade = getGrade(item.pm10Grade);                        // 미세먼지 등급으로 카드 색을 정한다
  const pm10 = formatValue(item.pm10Value, " ㎍/㎥");            // 미세먼지 표시 문구를 만든다
  const pm25 = formatValue(item.pm25Value, " ㎍/㎥");            // 초미세먼지 표시 문구를 만든다
  const time = String(item.dataTime ?? "").trim() || "정보 없음"; // 측정 시각이 없으면 '정보 없음'으로 둔다

  return `
    <article class="card ${grade.css}">
      <h2 class="card-name">${escapeHtml(item.stationName ?? "이름 없음")}</h2>
      <span class="badge">${grade.name}</span>
      <div class="card-row">
        <span>미세먼지</span>
        <span class="${pm10.valid ? "num" : "none"}">${pm10.text}</span>
      </div>
      <div class="card-row">
        <span>초미세먼지</span>
        <span class="${pm25.valid ? "num" : "none"}">${pm25.text}</span>
      </div>
      <p class="card-time">측정 시각 ${escapeHtml(time)}</p>
    </article>
  `;
}

// 측정소 목록으로 지역 평균 미세먼지를 계산해 요약 카드에 표시한다
function renderSummary(sidoName, items) {
  // 숫자로 쓸 수 있는 미세먼지 값만 골라낸다 ("-"는 평균 계산에서 제외한다)
  const numbers = items
    .filter((item) => isValidValue(item.pm10Value))
    .map((item) => Number(String(item.pm10Value).trim()));

  summaryLabel.textContent = `${sidoName} 평균 미세먼지`;        // 선택한 지역 이름을 설명 글에 넣는다
  summaryEl.className = "summary";                               // 이전에 적용된 등급 색을 초기화한다

  if (numbers.length === 0) {                                    // 쓸 수 있는 값이 하나도 없는 경우다
    summaryValue.textContent = "측정 안 됨";                     // 큰 숫자 자리에 안내 문구를 넣는다
    summaryUnit.textContent = "평균을 계산할 값이 없습니다.";    // 이유를 함께 알려준다
    summaryEl.classList.add("grade-none");                       // 회색으로 표시한다
    return;                                                      // 더 계산할 것이 없으므로 끝낸다
  }

  const sum = numbers.reduce((acc, cur) => acc + cur, 0);        // 유효한 값들을 모두 더한다
  const average = Math.round((sum / numbers.length) * 10) / 10;  // 평균을 소수점 한 자리로 반올림한다
  const grade = getGrade(gradeFromPm10(average));                // 평균 수치를 등급으로 바꾼다

  summaryValue.textContent = average;                            // 평균을 큰 숫자로 보여준다
  summaryUnit.textContent = `㎍/㎥ · ${grade.name} (측정소 ${numbers.length}곳 기준)`; // 단위와 등급을 보여준다
  summaryEl.classList.add(grade.css);                            // 평균 등급에 맞는 색을 입힌다
}

// 측정소 카드 목록을 화면에 그린다
function renderCards(items) {
  cardGrid.innerHTML = items.map(createCardHtml).join("");       // 카드 HTML을 한 번에 넣는다
}

/* ===== 전체 흐름 ===== */

// 선택한 시도의 데이터를 불러와 요약과 카드를 모두 갱신한다
async function loadSido(sidoName) {
  cardGrid.innerHTML = "";                                       // 이전 카드를 모두 지운다
  summaryValue.textContent = "--";                               // 평균 숫자를 초기화한다
  summaryUnit.textContent = "㎍/㎥";                             // 단위 문구를 초기화한다
  summaryEl.className = "summary";                               // 요약 카드 색을 초기화한다
  showStatus(`${sidoName} 측정소 정보를 불러오는 중입니다...`);  // 로딩 안내를 보여준다

  try {
    const items = await fetchDustData(sidoName);                 // API에서 측정소 목록을 받아온다

    if (items.length === 0) {                                    // 받아온 측정소가 없는 경우다
      renderSummary(sidoName, []);                               // 요약은 '측정 안 됨'으로 표시한다
      showStatus("표시할 측정소 정보가 없습니다.");              // 안내 문구를 보여준다
      return;                                                     // 그릴 카드가 없으므로 끝낸다
    }

    renderSummary(sidoName, items);                              // 평균 미세먼지를 계산해 보여준다
    renderCards(items);                                          // 측정소 카드를 그린다
    hideStatus();                                                 // 안내 문구를 감춘다
  } catch (error) {
    renderSummary(sidoName, []);                                 // 실패했으므로 요약을 비운 상태로 둔다
    showStatus(`정보를 불러오지 못했습니다. (${error.message})`, true); // 오류 내용을 화면에 보여준다
    console.error(error);                                        // 개발자 도구에 자세한 오류를 남긴다
  }
}

// 드롭다운에서 다른 시도를 고르면 해당 지역 데이터를 다시 불러온다
sidoSelect.addEventListener("change", (event) => {
  loadSido(event.target.value);                                  // 선택된 시도 이름으로 조회한다
});

// 페이지가 처음 열릴 때 드롭다운을 만들고 기본값(전국)을 조회한다
buildSidoOptions();                                              // 시도 옵션을 채운다
loadSido(sidoSelect.value);                                      // 첫 화면부터 데이터를 보여준다
