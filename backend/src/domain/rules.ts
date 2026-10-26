/**
 * Human readable group rules in English and Nepali, generated from the group
 * configuration so the text can never drift from the rules the system enforces.
 */
import { formatNpr } from './money';

export interface RuleSource {
  name: string;
  currency: string;
  contributionAmount: number;
  memberCount: number;
  startDate: Date;
  frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  collectionDueDay: number;
  selectionMethod: 'FIXED_ROTATION' | 'BIDDING' | 'ADMIN_SELECTION';
  lateFeeType: 'NONE' | 'FIXED' | 'PERCENTAGE' | 'DAILY';
  lateFeeValue: number;
  lateFeeCap: number | null;
  gracePeriodDays: number;
  continueAfterPot: boolean;
  minBidDiscount: number;
  bidWinRule: 'HIGHEST_DISCOUNT' | 'LOWEST_DISCOUNT';
  tieBreakRule: 'EARLIEST' | 'RANDOM';
  missedPaymentRules: string | null;
  earlyExitRules: string | null;
  earlyExitPenaltyBp: number;
}

const NE_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
export const toNepaliDigits = (s: string | number) => String(s).replace(/[0-9]/g, (d) => NE_DIGITS[Number(d)]);

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_NE = ['आइतबार', 'सोमबार', 'मंगलबार', 'बुधबार', 'बिहीबार', 'शुक्रबार', 'शनिबार'];

export function buildRules(g: RuleSource): { en: string[]; ne: string[] } {
  const amt = formatNpr(g.contributionAmount, g.currency);
  const amtNe = toNepaliDigits(formatNpr(g.contributionAmount, 'रु.').replace('रु. ', 'रु. '));
  const pot = formatNpr(g.contributionAmount * g.memberCount, g.currency);
  const potNe = toNepaliDigits(formatNpr(g.contributionAmount * g.memberCount, 'रु.'));
  const start = g.startDate.toISOString().slice(0, 10);
  const freqEn = { WEEKLY: 'every week', BIWEEKLY: 'every two weeks', MONTHLY: 'every month' }[g.frequency];
  const freqNe = { WEEKLY: 'हरेक हप्ता', BIWEEKLY: 'हरेक दुई हप्तामा', MONTHLY: 'हरेक महिना' }[g.frequency];
  const dueEn = g.frequency === 'MONTHLY' ? `on day ${g.collectionDueDay} of the month` : `on ${WEEKDAYS_EN[g.collectionDueDay]}`;
  const dueNe = g.frequency === 'MONTHLY' ? `महिनाको ${toNepaliDigits(g.collectionDueDay)} गते` : `${WEEKDAYS_NE[g.collectionDueDay]}`;

  const en: string[] = [];
  const ne: string[] = [];

  en.push(`Mero Kosh only keeps records. It never receives, holds or transfers money. Members pay each other directly (cash, bank transfer, eSewa, Khalti) and upload proof.`);
  ne.push(`Mero Kosh ले रेकर्ड मात्र राख्छ। यसले कुनै पनि रकम लिँदैन, राख्दैन वा पठाउँदैन। सदस्यहरूले नगद, बैंक, इसेवा वा खल्तीबाट आपसमै भुक्तानी गरी प्रमाण अपलोड गर्छन्।`);

  en.push(`Group "${g.name}" has ${g.memberCount} members. Each member contributes ${amt} ${freqEn}, due ${dueEn}, starting ${start}.`);
  ne.push(`"${g.name}" समूहमा ${toNepaliDigits(g.memberCount)} जना सदस्य छन्। प्रत्येक सदस्यले ${freqNe} ${amtNe} तिर्नुपर्छ, भुक्तानी मिति ${dueNe}, सुरु मिति ${toNepaliDigits(start)}।`);

  en.push(`There are ${g.memberCount} rounds. The full pot each round is the contribution × number of active members (${pot} when all members are active).`);
  ne.push(`जम्मा ${toNepaliDigits(g.memberCount)} चरण हुन्छन्। हरेक चरणको पूरा ढुकुटी = योगदान × सक्रिय सदस्य संख्या (सबै सक्रिय हुँदा ${potNe})।`);

  if (g.selectionMethod === 'FIXED_ROTATION') {
    en.push(`The pot recipient is chosen by a fixed rotation order agreed before the first round. The recipient receives the full pot.`);
    ne.push(`ढुकुटी पाउने सदस्य पहिलो चरण अघि तय गरिएको पालो (क्रम) अनुसार हुन्छ। पालो पर्ने सदस्यले पूरा ढुकुटी पाउँछन्।`);
  } else if (g.selectionMethod === 'BIDDING') {
    const minEn = formatNpr(g.minBidDiscount, g.currency);
    const minNe = toNepaliDigits(formatNpr(g.minBidDiscount, 'रु.'));
    const winEn = g.bidWinRule === 'HIGHEST_DISCOUNT' ? 'The member offering the largest discount wins.' : 'The member asking for the smallest discount wins.';
    const winNe = g.bidWinRule === 'HIGHEST_DISCOUNT' ? 'सबैभन्दा धेरै छुट (कमिसन) दिने सदस्यले जित्छन्।' : 'सबैभन्दा कम छुट माग्ने सदस्यले जित्छन्।';
    const tieEn = g.tieBreakRule === 'EARLIEST' ? 'Ties go to the earliest bid.' : 'Ties are decided by random draw.';
    const tieNe = g.tieBreakRule === 'EARLIEST' ? 'बराबर भएमा पहिले बोल लगाउनेले जित्छन्।' : 'बराबर भएमा चिट्ठा (र्‍यान्डम) बाट छानिन्छ।';
    en.push(`The pot recipient is chosen by sealed bidding before the due date. A bid is the discount the member accepts from the full pot (minimum ${minEn}, never more than the full pot). ${winEn} ${tieEn} All bids are revealed after the winner is selected.`);
    ne.push(`ढुकुटी पाउने सदस्य भुक्तानी मिति अघि गोप्य बोलकबोलबाट छानिन्छ। बोल भनेको पूरा ढुकुटीबाट छोड्न तयार भएको छुट रकम हो (न्यूनतम ${minNe}, पूरा ढुकुटीभन्दा बढी हुन सक्दैन)। ${winNe} ${tieNe} विजेता छानिएपछि सबै बोल सार्वजनिक गरिन्छ।`);
    en.push(`Winner receives: full pot − bid discount. The discount is shared equally among members who have not yet received the pot and is credited against their contribution for that round.`);
    ne.push(`विजेताले पाउने रकम: पूरा ढुकुटी − छुट रकम। छुट रकम अझै ढुकुटी नपाएका सदस्यहरूबीच बराबर बाँडिन्छ र सोही चरणको योगदानमा मिलान (घटाइ) गरिन्छ।`);
  }

  en.push(`A member can receive the pot only once per cycle, and a member with unpaid contributions cannot be selected.`);
  ne.push(`एक चक्रमा एक सदस्यले एक पटक मात्र ढुकुटी पाउँछन्, र बाँकी योगदान भएको सदस्य छानिन सक्दैनन्।`);

  en.push(g.continueAfterPot
    ? `Members who have already received the pot must continue contributing until the end of the cycle.`
    : `Members who have already received the pot stop contributing after their turn.`);
  ne.push(g.continueAfterPot
    ? `ढुकुटी पाइसकेका सदस्यले चक्र नसकिँदासम्म योगदान तिरिरहनुपर्छ।`
    : `ढुकुटी पाइसकेका सदस्यले आफ्नो पालोपछि योगदान तिर्नु पर्दैन।`);

  const graceEn = `${g.gracePeriodDays} day${g.gracePeriodDays === 1 ? '' : 's'}`;
  const graceNe = `${toNepaliDigits(g.gracePeriodDays)} दिन`;
  let feeEn = 'No late fee is charged.';
  let feeNe = 'ढिलो भुक्तानी शुल्क लाग्दैन।';
  if (g.lateFeeType === 'FIXED') {
    feeEn = `A fixed late fee of ${formatNpr(g.lateFeeValue, g.currency)} is charged once a payment is late.`;
    feeNe = `ढिलो भएमा एकमुष्ट ${toNepaliDigits(formatNpr(g.lateFeeValue, 'रु.'))} शुल्क लाग्छ।`;
  } else if (g.lateFeeType === 'PERCENTAGE') {
    const pct = (g.lateFeeValue / 100).toString();
    feeEn = `A late fee of ${pct}% of the unpaid amount is charged.`;
    feeNe = `बाँकी रकमको ${toNepaliDigits(pct)}% ढिलो शुल्क लाग्छ।`;
  } else if (g.lateFeeType === 'DAILY') {
    feeEn = `A late fee of ${formatNpr(g.lateFeeValue, g.currency)} is charged for every day late.`;
    feeNe = `ढिलो भएको प्रत्येक दिनको ${toNepaliDigits(formatNpr(g.lateFeeValue, 'रु.'))} शुल्क लाग्छ।`;
  }
  if (g.lateFeeType !== 'NONE' && g.lateFeeCap != null) {
    feeEn += ` Maximum late fee per round: ${formatNpr(g.lateFeeCap, g.currency)}.`;
    feeNe += ` एक चरणमा अधिकतम ढिलो शुल्क: ${toNepaliDigits(formatNpr(g.lateFeeCap, 'रु.'))}।`;
  }
  en.push(`Grace period: ${graceEn} after the due date. ${feeEn} Unpaid contributions are recorded as arrears.`);
  ne.push(`भुक्तानी मितिपछि ${graceNe} छुट अवधि हुन्छ। ${feeNe} नतिरेको योगदान बक्यौता (arrears) मा गनिन्छ।`);

  en.push(`Late fees are kept in the group fund and shared equally among members at the end of the cycle.`);
  ne.push(`ढिलो शुल्क समूह कोषमा रहन्छ र चक्रको अन्त्यमा सबै सदस्यबीच बराबर बाँडिन्छ।`);

  const penEn = g.earlyExitPenaltyBp ? ` An early-exit penalty of ${g.earlyExitPenaltyBp / 100}% of the refundable balance applies.` : '';
  const penNe = g.earlyExitPenaltyBp ? ` चाँडो छाड्दा फिर्ता हुने रकमको ${toNepaliDigits(g.earlyExitPenaltyBp / 100)}% जरिवाना लाग्छ।` : '';
  en.push(`Early exit: a member who already received the pot must pay all remaining contributions or provide an approved replacement. A member who has not received the pot gets their paid-in balance back at the end of the cycle, or a replacement takes their seat.${penEn}`);
  ne.push(`चाँडो छाड्ने: ढुकुटी पाइसकेका सदस्यले बाँकी सबै योगदान तिर्नुपर्छ वा स्वीकृत सट्टा सदस्य दिनुपर्छ। ढुकुटी नपाएका सदस्यले तिरेको रकम चक्रको अन्त्यमा फिर्ता पाउँछन्, वा सट्टा सदस्यले उनको स्थान लिन्छन्।${penNe}`);

  en.push(`Verified records cannot be edited. Mistakes are fixed with visible correction entries, and every action is recorded in the audit log. Members may dispute any record.`);
  ne.push(`प्रमाणित रेकर्ड सम्पादन गर्न मिल्दैन। गल्ती सच्याउन छुट्टै सुधार (correction) प्रविष्टि गरिन्छ र हरेक कार्य अडिट लगमा रहन्छ। सदस्यले कुनै पनि रेकर्डमा उजुरी गर्न सक्छन्।`);

  if (g.missedPaymentRules) {
    en.push(`Missed payment rules (group specific): ${g.missedPaymentRules}`);
    ne.push(`भुक्तानी छुटेमा लागू हुने समूहको नियम: ${g.missedPaymentRules}`);
  }
  if (g.earlyExitRules) {
    en.push(`Early exit rules (group specific): ${g.earlyExitRules}`);
    ne.push(`चाँडो छाड्दा लागू हुने समूहको नियम: ${g.earlyExitRules}`);
  }
  return { en, ne };
}
