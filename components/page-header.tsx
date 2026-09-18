import { cn } from "@/lib/utils";

const SANS = "var(--font-exo2), system-ui, sans-serif";
const SERIF = "var(--font-source-serif), 'Source Serif 4', Georgia, serif";
const MONO = "var(--font-jetbrains), ui-monospace, monospace";

interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: string;
  titleAccent?: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  titleAccent,
  description,
  children,
  className,
}: PageHeaderProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden border-b border-[color:var(--rule)] px-5 sm:px-8 lg:px-14",
        className
      )}
    >
      <div className="mx-auto max-w-[1440px] py-14 sm:py-20">
        {eyebrow && (
          <div
            className="mb-5 inline-flex items-center gap-1.5 text-[color:var(--rasp)]"
            style={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </div>
        )}
        <h1
          className="text-foreground"
          style={{
            fontFamily: SANS,
            fontWeight: 800,
            letterSpacing: "-0.045em",
            lineHeight: 0.95,
            fontSize: "clamp(2.25rem, 6vw, 5rem)",
            maxWidth: 1100,
            margin: 0,
          }}
        >
          {title}
          {titleAccent ? (
            <>
              {" "}
              <span
                style={{
                  color: "var(--rasp)",
                  fontFamily: SERIF,
                  fontStyle: "italic",
                  fontWeight: 400,
                }}
              >
                {titleAccent}
              </span>
            </>
          ) : null}
        </h1>
        {description && (
          <p
            className="mt-5 text-foreground/70"
            style={{
              fontFamily: SANS,
              fontSize: "clamp(1rem, 1.2vw, 1.125rem)",
              lineHeight: 1.5,
              maxWidth: 720,
            }}
          >
            {description}
          </p>
        )}
        {children && <div className="mt-7">{children}</div>}
      </div>
    </section>
  );
}
