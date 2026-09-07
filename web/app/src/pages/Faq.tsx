import { FaqSection } from "../components/FaqSection";
import { MarketingFooter, MarketingHeader } from "../brand/MarketingChrome";
import { useNavigate } from "react-router-dom";

/** Dedicated FAQ page so signed-in owners can open the answers from the
 * cabinet without hunting through the marketing homepage hash. Public, same
 * chrome as the landing page: logo returns to `/`, CTA returns to the app. */
export default function Faq() {
  const navigate = useNavigate();
  return (
    <div className="ev-page min-h-screen w-full">
      <MarketingHeader />
      <FaqSection headingLevel="h1" standalone />
      <MarketingFooter
        extra={
          <button onClick={() => navigate("/")} className="hover:text-ink transition-colors">
            Back to home
          </button>
        }
      />
    </div>
  );
}
