import React, { memo } from 'react';
import { S, R, FS } from '../../utils/tokens';

/**
 * Onboarding screen â€” extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Renders the 6-step onboarding wizard (name, demographics, sports, priorities,
 * training style, location). All state lives in App via props; handleOnboard
 * fires on the final step and writes the completed profile to Supabase.
 */

const OnboardingScreen = memo(function OnboardingScreen({
  // Current step (1â€“6)
  obStep, setObStep,
  // Name fields
  obName, setObName,
  obFirstName, setObFirstName,
  obLastName, setObLastName,
  // Demographics
  obAge, setObAge,
  obGender, setObGender,
  // Training preferences
  obFreq, setObFreq,
  obTiming, setObTiming,
  obSports, setObSports,
  obPriorities, setObPriorities,
  obStyle, setObStyle,
  // Location
  obState, setObState,
  obCountry, setObCountry,
  // Submit â€” defined in App, writes profile + sets screen
  handleOnboard,
}) {
const OB_SPORTS = [{
  val: "football",
  label: "ðŸˆ Football"
}, {
  val: "basketball",
  label: "ðŸ€ Basketball"
}, {
  val: "soccer",
  label: "âš½ Soccer"
}, {
  val: "baseball",
  label: "âš¾ Baseball"
}, {
  val: "volleyball",
  label: "ðŸ Volleyball"
}, {
  val: "tennis",
  label: "ðŸŽ¾ Tennis"
}, {
  val: "running",
  label: "ðŸƒ Track/Running"
}, {
  val: "cycling",
  label: "ðŸš´ Cycling"
}, {
  val: "swimming",
  label: "ðŸŠ Swimming"
}, {
  val: "triathlon",
  label: "ðŸ… Triathlon"
}, {
  val: "rowing",
  label: "ðŸš£ Rowing"
}, {
  val: "boxing",
  label: "ðŸ¥Š Boxing/Kickboxing"
}, {
  val: "mma",
  label: "ðŸ¥‹ MMA/Martial Arts"
}, {
  val: "wrestling",
  label: "ðŸ¤¼ Wrestling"
}, {
  val: "crossfit",
  label: "ðŸ” CrossFit"
}, {
  val: "powerlifting",
  label: "ðŸ‹ï¸ Powerlifting"
}, {
  val: "bodybuilding",
  label: "ðŸ’ª Bodybuilding"
}, {
  val: "yoga",
  label: "ðŸ§˜ Yoga/Pilates"
}, {
  val: "dance",
  label: "ðŸ’ƒ Dance/Cheer"
}, {
  val: "hiking",
  label: "ðŸ¥¾ Hiking/Rucking"
}, {
  val: "gymnastics",
  label: "ðŸ¤¸ Gymnastics"
}, {
  val: "golf",
  label: "â›³ Golf"
}, {
  val: "none",
  label: "ðŸš« No sports background"
}];
const OB_PRIORITIES = [{
  val: "be_strong",
  label: "ðŸ’ª Being Strong"
}, {
  val: "look_strong",
  label: "ðŸªž Looking Strong"
}, {
  val: "feel_good",
  label: "ðŸŒ¿ Feeling Good"
}, {
  val: "eat_right",
  label: "ðŸ¥— Eating Right"
}, {
  val: "mental_clarity",
  label: "ðŸ§  Mental Clarity"
}, {
  val: "athletic_perf",
  label: "ðŸ… Athletic Performance"
}, {
  val: "endurance",
  label: "ðŸ”¥ Endurance & Stamina"
}, {
  val: "longevity",
  label: "ðŸ•Šï¸ Longevity & Recovery"
}, {
  val: "competition",
  label: "ðŸ† Competition"
}, {
  val: "social",
  label: "ðŸ‘¥ Social/Community"
}, {
  val: "flexibility",
  label: "ðŸ¤¸ Mobility & Flex"
}, {
  val: "weight_loss",
  label: "âš–ï¸ Weight Management"
}];
const prog = `${obStep / 6 * 100}%`;
const chipSt = active => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 12px",
  borderRadius: R.r20,
  border: `1px solid ${active ? "#d4cec4" : "rgba(180,172,158,.06)"}`,
  background: active ? "rgba(74,69,59,.25)" : "rgba(74,69,59,.12)",
  color: active ? "#d4cec4" : "#9a9488",
  fontSize: FS.fs78,
  cursor: "pointer",
  margin: "3px",
  userSelect: "none"
});
const radioSt = active => ({
  display: "flex",
  alignItems: "flex-start",
  gap: S.s10,
  padding: "12px 14px",
  border: `1px solid ${active ? "#d4cec4" : "rgba(180,172,158,.06)"}`,
  borderRadius: R.r10,
  background: active ? "rgba(74,69,59,.25)" : "rgba(74,69,59,.12)",
  cursor: "pointer",
  marginBottom: S.s8
});
const toggleSport = v => {
  if (v === "none") {
    setObSports(s => s.includes("none") ? [] : ["none"]);
    return;
  }
  setObSports(s => s.includes("none") ? [v] : s.includes(v) ? s.filter(x => x !== v) : [...s, v]);
};
const togglePri = v => setObPriorities(s => s.includes(v) ? s.filter(x => x !== v) : s.length < 3 ? [...s, v] : s);
return <div className={"screen"}><div style={{
    height: 3,
    background: "rgba(180,172,158,.1)",
    borderRadius: R.r2,
    marginBottom: S.s18,
    overflow: "hidden"
  }}><div style={{
      height: "100%",
      width: prog,
      background: "#b4ac9e",
      borderRadius: R.r2,
      transition: "width .3s"
    }} /></div><div style={{
    fontSize: FS.fs62,
    color: "#9a9488",
    letterSpacing: ".14em",
    textTransform: "uppercase",
    marginBottom: S.s6
  }}>{`Step ${obStep} of 6`}</div>{obStep === 1 && <div><h1 className={"title"} style={{
      fontSize: "clamp(1.4rem,4vw,2rem)"
    }}>{"Create Your Build"}</h1><div className={"card"} style={{
      display: "flex",
      flexDirection: "column",
      gap: S.s14
    }}><div style={{
        display: "flex",
        gap: S.s10
      }}><div className={"field"} style={{
          flex: 1
        }}><label>{"First Name"}</label><input className={"inp"} value={obFirstName} onChange={e => setObFirstName(e.target.value)} placeholder={"First name"} /></div><div className={"field"} style={{
          flex: 1
        }}><label>{"Last Name"}</label><input className={"inp"} value={obLastName} onChange={e => setObLastName(e.target.value)} placeholder={"Last name"} /></div></div><div className={"field"}><label>{"Display Name "}<span style={{
            fontSize: FS.fs55,
            opacity: .6
          }}>{"(shown publicly)"}</span></label><input className={"inp"} value={obName} onChange={e => setObName(e.target.value)} placeholder={"Your gamertag or nickname\u2026"} /></div><div style={{
        display: "flex",
        gap: S.s10
      }}><div className={"field"} style={{
          flex: 1
        }}><label>{"Age "}<span style={{
              fontSize: FS.fs55,
              opacity: .6
            }}>{"(optional)"}</span></label><input className={"inp"} type={"number"} min={"13"} max={"99"} value={obAge} onChange={e => setObAge(e.target.value)} placeholder={"25"} /></div><div className={"field"} style={{
          flex: 1
        }}><label>{"Sex "}<span style={{
              fontSize: FS.fs55,
              opacity: .6
            }}>{"(optional)"}</span></label><div style={{
            display: "flex",
            gap: S.s6,
            flexWrap: "wrap",
            marginTop: S.s4
          }}>{["Male", "Female", "Other"].map(g => <button key={g} className={`gender-btn ${obGender === g ? "sel" : ""}`} onClick={() => setObGender(prev => prev === g ? "" : g)}>{g}</button>)}</div></div></div><div style={{
        display: "flex",
        gap: S.s10
      }}><div className={"field"} style={{
          flex: 1
        }}><label>{"State"}</label><select className={"inp"} value={obState} onChange={e => setObState(e.target.value)} style={{
            cursor: "pointer"
          }}><option value={""}>{"Select State"}</option>{["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"].map(s => <option key={s} value={s}>{s}</option>)}</select></div><div className={"field"} style={{
          flex: 1
        }}><label>{"Country"}</label><select className={"inp"} value={obCountry} onChange={e => setObCountry(e.target.value)} style={{
            cursor: "pointer"
          }}>{["United States", "Canada", "United Kingdom", "Australia", "Germany", "France", "Mexico", "Brazil", "India", "Japan", "South Korea", "Philippines", "Other"].map(c => <option key={c} value={c}>{c}</option>)}</select></div></div><button className={"btn btn-gold"} disabled={!obName.trim() || !obFirstName.trim() || !obLastName.trim() || !obState || !obCountry} onClick={() => setObStep(2)}>{"Continue â†’"}</button></div></div>}{obStep === 2 && <div><h1 className={"title"} style={{
      fontSize: "clamp(1.3rem,4vw,1.9rem)"
    }}>{"Athletic History"}</h1><p style={{
      color: "#9a9488",
      fontSize: FS.fs82,
      marginBottom: S.s12
    }}>{"Select all sports you've played â€” past or present. This is your strongest class signal."}</p><div style={{
      marginBottom: S.s16
    }}>{OB_SPORTS.map(s => <span key={s.val} style={chipSt(obSports.includes(s.val))} onClick={() => toggleSport(s.val)}>{s.label}</span>)}</div><div style={{
      display: "flex",
      gap: S.s8
    }}><button className={"btn btn-ghost"} onClick={() => setObStep(1)}>{"â† Back"}</button><button className={"btn btn-gold"} onClick={() => setObStep(3)}>{"Continue â†’"}</button></div></div>}{obStep === 3 && <div><h1 className={"title"} style={{
      fontSize: "clamp(1.3rem,4vw,1.9rem)"
    }}>{"Current Routine"}</h1><p style={{
      color: "#9a9488",
      fontSize: FS.fs82,
      marginBottom: S.s12
    }}>{"How often do you work out today? Be honest â€” this calibrates your starting stats."}</p>{[{
      val: "never",
      label: "Just getting started",
      sub: "Little to no workout history"
    }, {
      val: "light",
      label: "1â€“2 times a week",
      sub: "Casual, inconsistent routine"
    }, {
      val: "moderate",
      label: "3â€“4 times a week",
      sub: "Solid habit, building consistency"
    }, {
      val: "dedicated",
      label: "5â€“6 times a week",
      sub: "Dedicated athlete"
    }, {
      val: "elite",
      label: "Daily or twice a day",
      sub: "Elite training volume"
    }].map(o => <div key={o.val} style={radioSt(obFreq === o.val)} onClick={() => setObFreq(o.val)}><div><div style={{
          fontSize: FS.fs82,
          fontWeight: 600,
          color: obFreq === o.val ? "#d4cec4" : "#b4ac9e"
        }}>{o.label}</div><div style={{
          fontSize: FS.lg,
          color: "#9a9488",
          marginTop: S.s2
        }}>{o.sub}</div></div></div>)}<div style={{
      display: "flex",
      gap: S.s8,
      marginTop: S.s6
    }}><button className={"btn btn-ghost"} onClick={() => setObStep(2)}>{"â† Back"}</button><button className={"btn btn-gold"} disabled={!obFreq} onClick={() => setObStep(4)}>{"Continue â†’"}</button></div></div>}{obStep === 4 && <div><h1 className={"title"} style={{
      fontSize: "clamp(1.3rem,4vw,1.9rem)"
    }}>{"Discipline Trait"}</h1><p style={{
      color: "#9a9488",
      fontSize: FS.fs82,
      marginBottom: S.s12
    }}>{"When do you usually work out? Timing unlocks hidden character traits."}</p>{[{
      val: "earlymorning",
      label: "Early morning (before 7am)",
      sub: "âš¡ Iron Discipline â€” +WIS +CON boost. One of the rarest traits."
    }, {
      val: "morning",
      label: "Morning (7amâ€“12pm)",
      sub: "â˜€ï¸ Disciplined â€” +WIS boost"
    }, {
      val: "afternoon",
      label: "Afternoon (12pmâ€“5pm)",
      sub: "Balanced â€” no trait modifier"
    }, {
      val: "evening",
      label: "Evening (5pmâ€“9pm)",
      sub: "ðŸŒ™ Night Owl â€” +VIT boost"
    }, {
      val: "varies",
      label: "It varies / no routine yet",
      sub: "No trait â€” earn one as you build your routine"
    }].map(o => <div key={o.val} style={radioSt(obTiming === o.val)} onClick={() => setObTiming(o.val)}><div><div style={{
          fontSize: FS.fs82,
          fontWeight: 600,
          color: obTiming === o.val ? "#d4cec4" : "#b4ac9e"
        }}>{o.label}</div><div style={{
          fontSize: FS.lg,
          color: "#9a9488",
          marginTop: S.s2
        }}>{o.sub}</div></div></div>)}<div style={{
      display: "flex",
      gap: S.s8,
      marginTop: S.s6
    }}><button className={"btn btn-ghost"} onClick={() => setObStep(3)}>{"â† Back"}</button><button className={"btn btn-gold"} disabled={!obTiming} onClick={() => setObStep(5)}>{"Continue â†’"}</button></div></div>}{obStep === 5 && <div><h1 className={"title"} style={{
      fontSize: "clamp(1.3rem,4vw,1.9rem)"
    }}>{"Fitness Identity"}</h1><p style={{
      color: "#9a9488",
      fontSize: FS.fs82,
      marginBottom: S.s12
    }}>{"Pick up to 3 that best describe your mindset. These shape your stat affinity."}</p><div style={{
      marginBottom: S.s12
    }}>{OB_PRIORITIES.map(p => <span key={p.val} style={chipSt(obPriorities.includes(p.val))} onClick={() => togglePri(p.val)}>{p.label}</span>)}<div style={{
        fontSize: FS.fs68,
        color: "#9a9488",
        marginTop: S.s6,
        fontStyle: "italic"
      }}>{`${obPriorities.length}/3 selected`}</div></div><div style={{
      display: "flex",
      gap: S.s8
    }}><button className={"btn btn-ghost"} onClick={() => setObStep(4)}>{"â† Back"}</button><button className={"btn btn-gold"} onClick={() => setObStep(6)}>{"Continue â†’"}</button></div></div>}{obStep === 6 && <div><h1 className={"title"} style={{
      fontSize: "clamp(1.3rem,4vw,1.9rem)"
    }}>{"Training Style"}</h1><p style={{
      color: "#9a9488",
      fontSize: FS.fs82,
      marginBottom: S.s12
    }}>{"Your natural approach to fitness â€” this fine-tunes your class assignment."}</p>{[{
      val: "heavy",
      label: "Heavy compound lifts",
      sub: "Squats, deadlifts, bench â€” I chase weight on the bar"
    }, {
      val: "cardio",
      label: "Cardio & endurance",
      sub: "Running, cycling, swimming â€” I chase distance and time"
    }, {
      val: "sculpt",
      label: "Sculpting & aesthetics",
      sub: "Isolation work and volume â€” I chase the look"
    }, {
      val: "hiit",
      label: "HIIT & explosive power",
      sub: "Short intense bursts, circuits, functional fitness"
    }, {
      val: "mindful",
      label: "Mindful movement",
      sub: "Yoga, mobility, breath work â€” mind-body connection"
    }, {
      val: "sport",
      label: "Sport-specific training",
      sub: "I train to compete or perform â€” sport is the goal"
    }, {
      val: "mixed",
      label: "I mix everything",
      sub: "No single focus â€” variety keeps me going"
    }].map(o => <div key={o.val} style={radioSt(obStyle === o.val)} onClick={() => setObStyle(o.val)}><div><div style={{
          fontSize: FS.fs82,
          fontWeight: 600,
          color: obStyle === o.val ? "#d4cec4" : "#b4ac9e"
        }}>{o.label}</div><div style={{
          fontSize: FS.lg,
          color: "#9a9488",
          marginTop: S.s2
        }}>{o.sub}</div></div></div>)}<div style={{
      display: "flex",
      gap: S.s8,
      marginTop: S.s6
    }}><button className={"btn btn-ghost"} onClick={() => setObStep(5)}>{"â† Back"}</button><button className={"btn btn-gold"} disabled={!obStyle} onClick={handleOnboard}>{"Forge My Character â†’"}</button></div></div>}</div>;
});

export default OnboardingScreen;
