export default function Footer() {
  const year = new Date().getFullYear();
  const hostname =
    typeof window !== "undefined" ? window.location.hostname : "";
  const caffeineUrl = `https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(hostname)}`;

  return (
    <footer className="border-t border-border/50 mt-16 py-8 bg-sidebar">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {[
              "Home",
              "Explore",
              "About",
              "Contact",
              "Privacy Policy",
              "Terms of Service",
            ].map((link) => (
              <span
                key={link}
                className="text-muted-foreground text-xs cursor-default"
              >
                {link}
              </span>
            ))}
          </nav>
          <p className="text-muted-foreground/60 text-xs">
            © {year}. Built with ❤️ using{" "}
            <a
              href={caffeineUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary/70 hover:text-primary transition-colors"
            >
              caffeine.ai
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
