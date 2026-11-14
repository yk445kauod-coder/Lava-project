import { Link } from "react-router-dom";

interface BrandLogoProps {
  className?: string;
}

/** The project logo box, shown exactly as supplied wherever the brand appears. */
export function BrandLogo({ className = "" }: BrandLogoProps) {
  return (
    <Link className={`brand-lockup-link ${className}`.trim()} to="/" aria-label="LAVA home">
      <img
        className="brand-lockup"
        src="/logo-mark.png"
        alt="LAVA logo"
      />
    </Link>
  );
}
