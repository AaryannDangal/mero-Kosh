import { Link } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';
import { LangToggle } from '../components/LangToggle';
import { useI18n } from '../lib/i18n';

export function PrivacyPage() {
  const { t } = useI18n();
  return (
    <main className="min-h-screen bg-[#f7f8f3] px-4 py-6 text-stone-800 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <Link to="/login" className="flex items-center gap-3 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-700">
            <BrandLogo size={44} />
            <span className="font-bold text-stone-900">Mero Kosh</span>
          </Link>
          <LangToggle />
        </header>
        <article className="rounded-3xl border border-stone-200 bg-white px-5 py-7 shadow-sm sm:px-9 sm:py-10">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-brand-700">Mero Kosh · मेरो कोष</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-stone-950">{t('privacyPolicy')}</h1>
          <p className="mt-2 text-sm text-stone-500">Effective 26 October 2026 · प्रभावकारी मिति: २६ अक्टोबर २०२६</p>

          <div className="mt-8 space-y-8 leading-7">
            <section>
              <h2 className="text-xl font-bold text-stone-900">Who operates Mero Kosh / Mero Kosh कसले सञ्चालन गर्छ</h2>
              <p className="mt-2">Mero Kosh is operated by Aaryan Dangal. For privacy questions or account-deletion help, contact <a className="font-semibold text-brand-700 underline underline-offset-2" href="mailto:itidady@gmail.com">itidady@gmail.com</a>.</p>
              <p className="mt-2" lang="ne">Mero Kosh Aaryan Dangal द्वारा सञ्चालन गरिन्छ। गोपनीयता वा खाता मेटाउने सहयोगका लागि <a className="font-semibold text-brand-700 underline underline-offset-2" href="mailto:itidady@gmail.com">itidady@gmail.com</a> मा सम्पर्क गर्नुहोस्।</p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-stone-900">Information the app uses / एपले प्रयोग गर्ने जानकारी</h2>
              <p className="mt-2">The app may store your name, phone number, optional email, password hash or Google sign-in identifier, language and alert preferences, group membership, pot requests, payment records, receipts or photos, disputes, and security/audit details such as timestamps and IP addresses.</p>
              <p className="mt-2" lang="ne">एपले तपाईंको नाम, फोन नम्बर, ऐच्छिक इमेल, पासवर्डको सुरक्षित ह्यास वा Google लग इन पहिचान, भाषा र सूचना प्राथमिकता, समूह सदस्यता, ढुकुटी अनुरोध, भुक्तानी विवरण, रसिद वा फोटो, विवाद, र समय तथा IP ठेगाना जस्ता सुरक्षा/अडिट विवरण राख्न सक्छ।</p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-stone-900">How it is used and shared / प्रयोग र साझेदारी</h2>
              <p className="mt-2">Information is used to run accounts and invitations, show group ledgers, calculate balances, keep payment evidence, send in-app reminders, and protect and support the service. Group members can see shared group records; organizers have additional administration and reconciliation access. Contact details and receipts are restricted by role.</p>
              <p className="mt-2" lang="ne">जानकारी खाता र निमन्त्रणा सञ्चालन, समूहको हिसाब देखाउन, रकम गणना गर्न, भुक्तानी प्रमाण राख्न, एपभित्र सूचना पठाउन, र सेवा सुरक्षित तथा सहयोग गर्न प्रयोग हुन्छ। समूहका सदस्यले साझा समूह विवरण देख्न सक्छन्; आयोजकसँग थप व्यवस्थापन र मिलान पहुँच हुन्छ। सम्पर्क विवरण र रसिद भूमिका अनुसार सीमित हुन्छन्।</p>
            </section>

            <section className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 sm:p-5">
              <h2 className="text-xl font-bold text-stone-900">Account deletion and group records / खाता मेटाउने र समूहको विवरण</h2>
              <p className="mt-2">You can delete your account from Account settings. We verify password accounts with the current password and Google-only accounts with a fresh Google confirmation. We then remove your sign-in account, phone and email from your member seat, profile photo, and personal in-app notifications. Your group seat is shown as “Former member”. Group payment entries, receipts, pot decisions, disputes, and immutable audit history remain so the group’s records stay complete. Historical audit details may retain names or contact/payment details recorded at the time; receipts may also contain identifying details. Backups may retain deleted data until their normal rotation. If you organize an unfinished group, a linked co-organizer must already be present; leadership is transferred as part of deletion.</p>
              <p className="mt-2" lang="ne">खाता सेटिङबाट खाता मेटाउन सक्नुहुन्छ। पासवर्ड खातामा हालको पासवर्ड र Google मात्र प्रयोग गर्ने खातामा नयाँ Google पुष्टि आवश्यक हुन्छ। त्यसपछि लग इन खाता, सदस्यताबाट फोन र इमेल, प्रोफाइल फोटो, र व्यक्तिगत एपभित्रका सूचनाहरू हटाइन्छन्। समूहमा तपाईं “पूर्व सदस्य” भनेर देखिनुहुन्छ। समूहको विवरण पूरा राख्न भुक्तानी प्रविष्टि, रसिद, ढुकुटी निर्णय, विवाद र परिवर्तन गर्न नमिल्ने अडिट इतिहास रहन्छ। पुरानो अडिट विवरणमा त्यसबेलाको नाम वा सम्पर्क/भुक्तानी विवरण र रसिदमा पहिचान खुल्ने जानकारी रहन सक्छ। ब्याकअपमा सामान्य घुम्ती अवधिसम्म मेटाइएको विवरण रहन सक्छ। अधुरो समूहको आयोजक भएमा पहिले जोडिएको सह-आयोजक हुनुपर्छ; खाता मेटाउँदा नेतृत्व हस्तान्तरण हुन्छ।</p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-stone-900">Money and service providers / रकम र सेवा प्रदायक</h2>
              <p className="mt-2">Mero Kosh only keeps records. It does not receive, hold, or transfer group money. To provide the app, the operator uses hosting, database, and file-storage providers; email or Google may also process information when those features are enabled. Provider names and processing locations will be listed here before a public deployment.</p>
              <p className="mt-2" lang="ne">Mero Kosh ले हिसाब मात्र राख्छ। यसले समूहको रकम लिँदैन, राख्दैन वा पठाउँदैन। एप चलाउन होस्टिङ, डाटाबेस र फाइल भण्डारण सेवा प्रदायक प्रयोग हुन्छन्; इमेल वा Google सुविधा खोलिएमा तिनले पनि जानकारी प्रशोधन गर्न सक्छन्। सार्वजनिक रूपमा सञ्चालन गर्नुअघि प्रदायकको नाम र प्रशोधन हुने स्थान यहाँ राखिनेछ।</p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-stone-900">Security and questions / सुरक्षा र प्रश्नहरू</h2>
              <p className="mt-2">Access controls and technical safeguards are used to protect information, but no online service can guarantee absolute security. Contact <a className="font-semibold text-brand-700 underline underline-offset-2" href="mailto:itidady@gmail.com">itidady@gmail.com</a> for privacy questions or help.</p>
              <p className="mt-2" lang="ne">जानकारी सुरक्षित राख्न पहुँच नियन्त्रण र प्राविधिक उपाय प्रयोग गरिन्छ, तर कुनै पनि अनलाइन सेवाले पूर्ण सुरक्षा सुनिश्चित गर्न सक्दैन। गोपनीयता सम्बन्धी प्रश्न वा सहयोगका लागि <a className="font-semibold text-brand-700 underline underline-offset-2" href="mailto:itidady@gmail.com">itidady@gmail.com</a> मा लेख्नुहोस्।</p>
            </section>
          </div>
        </article>
        <p className="mt-6 text-center text-sm"><Link className="font-semibold text-brand-700 underline underline-offset-2" to="/login">{t('login')}</Link></p>
      </div>
    </main>
  );
}
