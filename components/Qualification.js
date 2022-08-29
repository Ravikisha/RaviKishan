import React, { useState } from "react";

const Qualification = () => {
  const [toggleQualification, setToggleQualification] = useState(1);

  const toggleTab = (index) => {
    setToggleQualification(index);
  };
  return (
    <>
      <section className="qualification section">
        <h2 className="section__title text-5xl font-bold text-center text-gray-800 mb-10 ">
          Qualification
        </h2>
        <span className="section__subtitle text-xl md:text-2xl">
          My Personal Journey
        </span>
        <div className="qualification__container container__mod">
          <div className="qualification__tabs">
            <div
              className={
                toggleQualification === 1
                  ? "qualification__button qualification__active button--flex"
                  : "qualification__button  button--flex"
              }
              onClick={()=>toggleTab(1)}
            >
              <i className="uil uil-graduation-cap qualification__icon mx-3"></i>
              Education
            </div>
            <div className={
                toggleQualification === 2
                  ? "qualification__button qualification__active button--flex"
                  : "qualification__button  button--flex"
              }
              onClick={()=>toggleTab(2)}
              >
              <i className="uil uil-briefcase-alt qualification__icon mx-3"></i>
              Experience
            </div>
          </div>
        </div>  
        <div className="qualification__sections">
          <div className={toggleQualification === 1 ? "qualification__content qualification__content-active" : "qualification__content"}>
            <div className="qualification__data">
              <div>
                <h3 className="qualification__title">Tester</h3>
                <span className="qualification__subtitle">
                  Spain - Institute
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> 2021 - Present
                </div>
              </div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
            </div>

            <div className="qualification__data">
              <div></div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
              <div>
                <h3 className="qualification__title">Programmer</h3>
                <span className="qualification__subtitle">
                  Spain - Institute
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> 2021 - Present
                </div>
              </div>
            </div>
            <div className="qualification__data">
              <div>
                <h3 className="qualification__title">Tester</h3>
                <span className="qualification__subtitle">
                  Spain - Institute
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> 2021 - Present
                </div>
              </div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
            </div>

            <div className="qualification__data">
              <div></div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
              <div>
                <h3 className="qualification__title">Programmer</h3>
                <span className="qualification__subtitle">
                  Spain - Institute
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> 2021 - Present
                </div>
              </div>
            </div>
          </div>
          <div className={toggleQualification === 2 ? "qualification__content qualification__content-active" : "qualification__content"}>
            <div className="qualification__data">
              <div>
                <h3 className="qualification__title">Developer</h3>
                <span className="qualification__subtitle">
                  Spain - Institute
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> 2021 - Present
                </div>
              </div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
            </div>

            <div className="qualification__data">
              <div></div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
              <div>
                <h3 className="qualification__title">Programmer</h3>
                <span className="qualification__subtitle">
                  Spain - Institute
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> 2021 - Present
                </div>
              </div>
            </div>
            <div className="qualification__data">
              <div>
                <h3 className="qualification__title">Tester</h3>
                <span className="qualification__subtitle">
                  Spain - Institute
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> 2021 - Present
                </div>
              </div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
            </div>

            <div className="qualification__data">
              <div></div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
              <div>
                <h3 className="qualification__title">Programmer</h3>
                <span className="qualification__subtitle">
                  Spain - Institute
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> 2021 - Present
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default Qualification;
