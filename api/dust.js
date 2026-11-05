// Vercel 서버리스 함수 — 브라우저 대신 서버에서 에어코리아 API를 호출해 인증키를 숨긴다

// 한국환경공단 에어코리아 '대기오염정보' 시도별 실시간 측정정보 조회 주소다
const AIRKOREA_URL = "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty";

// 조회를 허용할 시도 이름 목록이다 (엉뚱한 값이 그대로 외부 API로 넘어가지 않게 막는다)
const ALLOWED_SIDO = ["전국", "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
                      "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];

// 공공데이터포털이 돌려주는 결과 코드를 한국어 안내 문구로 바꿔주는 표다
const RESULT_MESSAGES = {
  "01": "제공 기관 서비스에 오류가 있습니다. 잠시 후 다시 시도해주세요.",
  "02": "공공데이터포털 서버에 오류가 있습니다. 잠시 후 다시 시도해주세요.",
  "03": "조회된 자료가 없습니다.",
  "04": "요청 변수에 문제가 있습니다. 시도 이름을 확인해주세요.",
  "10": "잘못된 요청 변수가 있습니다. 시도 이름을 확인해주세요.",
  "12": "중단된 서비스입니다. API 상태를 확인해주세요.",
  "20": "접근이 거부되었습니다. 활용 신청이 승인되었는지 확인해주세요.",
  "22": "일일 트래픽 한도를 초과했습니다. 내일 다시 시도해주세요.",
  "30": "등록되지 않은 인증키입니다. AIRKOREA_KEY 값을 확인해주세요.",
  "31": "인증키 사용 기간이 만료되었습니다. 공공데이터포털에서 연장해주세요.",
  "32": "등록되지 않은 IP 에서의 요청입니다.",
  "99": "알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
};

// 환경변수에 Decoding 키 대신 Encoding 키를 넣었더라도 원래 값으로 되돌린다
function normalizeKey(rawKey) {
  try {
    return decodeURIComponent(rawKey);   // %가 섞인 Encoding 키라면 Decoding 키로 되돌아온다
  } catch {
    return rawKey;                       // 디코딩이 불가능한 형태면 원래 값을 그대로 쓴다
  }
}

// Vercel 이 요청을 받을 때 실행하는 기본 처리 함수다
export default async function handler(req, res) {
  // GET 이외의 방식으로 들어온 요청은 받지 않는다
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, message: "GET 방식으로만 요청할 수 있습니다." });
  }

  // 주소 쿼리에서 sido 값을 꺼낸다 (req.query 가 없는 환경을 대비해 직접 파싱도 준비한다)
  const fallback = new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams;
  const sido = String(req.query?.sido ?? fallback.get("sido") ?? "").trim() || "서울"; // 값이 없으면 기본값은 '서울'이다

  // 허용 목록에 없는 시도 이름이면 요청을 거절한다
  if (!ALLOWED_SIDO.includes(sido)) {
    return res.status(400).json({ ok: false, message: `'${sido}' 는 조회할 수 없는 시도 이름입니다.` });
  }

  // 인증키는 코드가 아니라 환경변수에서만 읽는다
  const rawKey = process.env.AIRKOREA_KEY;
  if (!rawKey) {
    return res.status(500).json({ ok: false, message: "서버에 인증키(AIRKOREA_KEY)가 설정되지 않았습니다." });
  }

  // 외부 API 에 붙일 요청 변수를 만든다 (URLSearchParams 가 인증키를 알맞게 인코딩해준다)
  const params = new URLSearchParams({
    serviceKey: normalizeKey(rawKey),   // Decoding 상태로 정리한 인증키다
    returnType: "json",                 // 응답을 JSON 으로 요청한다
    sidoName: sido,                     // 조회할 시도 이름이다
    numOfRows: "700",                   // 전국 측정소(약 673곳)를 한 번에 모두 받는다
    pageNo: "1",                        // 첫 번째 페이지를 요청한다
    ver: "1.3"                          // 초미세먼지(pm25Value)가 포함된 버전이다
  });

  let text; // 외부 API 의 응답 본문을 문자열로 담아둘 변수다

  try {
    // 외부 API 를 호출한다 (10초 안에 응답이 없으면 중단한다)
    const upstream = await fetch(`${AIRKOREA_URL}?${params}`, { signal: AbortSignal.timeout(10000) });
    text = await upstream.text();       // JSON 인지 XML 인지 모르므로 우선 글자 그대로 받는다
  } catch (error) {
    // 네트워크 오류나 시간 초과인 경우다
    return res.status(504).json({ ok: false, message: "대기오염정보 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요." });
  }

  let data; // JSON 으로 해석한 결과를 담을 변수다

  try {
    data = JSON.parse(text);            // 정상이라면 JSON 으로 해석된다
  } catch {
    // JSON 이 아니라 XML 형태의 오류 응답이 온 경우다 (잘못된 인증키에서 주로 발생한다)
    return res.status(502).json({ ok: false, message: "인증키 또는 요청값을 확인해주세요" });
  }

  // 인증키 문제 등은 모양이 전혀 다른 JSON(OpenAPI_ServiceResponse)으로 오므로 먼저 확인한다
  const gatewayHeader = data?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gatewayHeader) {
    const reasonCode = gatewayHeader.returnReasonCode;                      // 사유 코드를 꺼낸다
    const message = RESULT_MESSAGES[reasonCode] || "인증키 또는 요청값을 확인해주세요"; // 코드에 맞는 한국어 문구를 고른다
    return res.status(502).json({ ok: false, message, resultCode: reasonCode ?? null });
  }

  // 응답 본문 안의 결과 코드를 확인한다
  const resultCode = data?.response?.header?.resultCode;
  if (resultCode !== "00") {
    // 성공(00)이 아니면 코드에 맞는 한국어 안내 문구를 돌려준다
    const message = RESULT_MESSAGES[resultCode] || "인증키 또는 요청값을 확인해주세요";
    return res.status(502).json({ ok: false, message, resultCode: resultCode ?? null });
  }

  // 측정소 목록과 전체 개수를 꺼낸다
  const body = data?.response?.body ?? {};
  const items = Array.isArray(body.items) ? body.items : [];

  // 같은 응답을 60초간 재사용해 공공데이터포털 일일 호출 한도를 아낀다
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");

  // 화면에서 바로 쓸 수 있는 형태로 정리해 돌려준다
  return res.status(200).json({
    ok: true,                               // 성공 여부다
    sido,                                   // 조회한 시도 이름이다
    totalCount: body.totalCount ?? items.length, // 해당 시도의 전체 측정소 수다
    items                                   // 측정소 목록이다
  });
}
