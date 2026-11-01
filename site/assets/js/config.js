window.PHILTER = {
  // The install buttons detect the browser (site.js): Edge goes to stores.edge, the Chrome family to
  // stores.chrome, and anything not listed yet to the GitHub zip. Chrome launch day: put the Chrome Web
  // Store URL in installUrl AND stores.chrome (installUrl also flips the roadmap's store items), and add
  // it to "downloadUrl" in the SoftwareApplication JSON-LD in both index pages.
  installUrl: "",                                   // "" = "coming soon" state everywhere
  downloadUrl: "https://github.com/PhilterAds/philterads/releases/latest/download/philterads.zip", // latest GitHub release zip (load unpacked)
  githubUrl: "https://github.com/PhilterAds/philterads",
  sponsorsUrl: "https://github.com/sponsors/PhilterAds",
  repoOpen: true,                                   // true once the repo is public: shows every GitHub link
  sponsorsOpen: false,                              // true once GitHub Sponsors is approved: adds the "Prefer GitHub?" line
  stores: { chrome: "", edge: "https://microsoftedge.microsoft.com/addons/detail/philterads/epaelpoafnbapdflkoflbpdmbflojoab", firefox: "", opera: "" }, // each badge shows only once its listing URL is set
  // Stripe Payment Links (buy.stripe.com/...): tiers go live only once all five are set
  stripe: {
    t1: "https://buy.stripe.com/00w14p9m8c40efs2hUeZ200",
    t2: "https://buy.stripe.com/dRm8wRgOA9VS4ESg8KeZ201",
    t3: "https://buy.stripe.com/9B6cN7cykd840oC2hUeZ202",
    t4: "https://buy.stripe.com/28EdRbeGs2tq6N07CeeZ203",
    t5: "https://buy.stripe.com/bJe4gBdCo0li7R409MeZ204",
    portal: "https://billing.stripe.com/p/login/00w14p9m8c40efs2hUeZ200"
  },
  sponsors: { count: null, asOf: null }             // both set => goal bar shows, else hidden
};
