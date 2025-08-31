import Image from "next/image";
import Link from "next/link";

const Map = () => {
  return (
    <>
      <div className="bg-gradient-to-b from-green-50 to-green-100">
        <section className="py-10 sm:py-16 lg:py-24">
          <div className="px-4 mx-auto max-w-7xl sm:px-6 lg:px-8">
            <div className="grid items-center grid-cols-1 gap-12 lg:grid-cols-2">
              <div data-aos="flip-left">
                <h1 className="text-4xl font-bold text-black sm:text-6xl lg:text-7xl">
                  Languages I can&apos;t speak,
                  <div className="relative inline-flex">
                    <span className="absolute inset-x-0 bottom-0 border-b-[30px] border-[#4ADE80]"></span>
                    <h1 className="relative text-4xl font-bold text-black sm:text-6xl lg:text-7xl">
                      Dev & Design
                    </h1>
                  </div>
                  Tools that I particularly enjoy
                </h1>

                <p className="mt-8 text-base text-black sm:text-xl">
                  There are so many technologies out there, and I&apos;m always
                  looking to learn more. I&apos;ve been working with these for a
                  while now, and I&apos;m always looking to learn more.
                </p>

                <div className="mt-10 sm:flex sm:items-center sm:space-x-8">
                  <Link href="/skills">
                    <div className="relative cursor-pointer inline-flex items-center justify-start py-3 pl-4 pr-12 overflow-hidden font-semibold text-[#F97316] transition-all duration-150 ease-in-out rounded hover:pl-10 hover:pr-6 bg-gray-50 group">
                      <span className="absolute bottom-0 left-0 w-full h-1 transition-all duration-150 ease-in-out bg-[#F97316] group-hover:h-full"></span>
                      <span className="absolute right-0 pr-4 duration-200 ease-out group-hover:translate-x-12">
                        <svg
                          className="w-5 h-5 text-[#F97316]"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M14 5l7 7m0 0l-7 7m7-7H3"
                          ></path>
                        </svg>
                      </span>
                      <span className="absolute left-0 pl-2.5 -translate-x-12 group-hover:translate-x-0 ease-out duration-200">
                        <svg
                          className="w-5 h-5 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M14 5l7 7m0 0l-7 7m7-7H3"
                          ></path>
                        </svg>
                      </span>
                      <span className="relative w-full text-left transition-colors duration-200 ease-in-out group-hover:text-white">
                        Go to Skills
                      </span>
                    </div>
                  </Link>
                </div>
              </div>

              <div data-aos="flip-right">
                <Image
                  width={800}
                  height={800}
                  objectFit="contain"
                  className="w-full"
                  src="https://cdn.rareblocks.xyz/collection/celebration/images/hero/2/hero-img.png"
                  alt=""
                />
              </div>
            </div>
            <div className="socials" data-aos="zoom-in">
              <Link href="https://www.linkedin.com/in/ravi-kishan-62ab51221/">
                <a className="btn__social in" target="_blank">
                  <i className="fab fa-linkedin"></i>
                </a>
              </Link>
              <Link href="https://x.com/RaviKishan_">
                <a className="btn__social tw" target="_blank">
                  <i className="fab fa-twitter"></i>
                </a>
              </Link>
              <Link href="https://github.com/ravikisha/">
                <a className="btn__social gh" target="_blank">
                  <i className="fab fa-github"></i>
                </a>
              </Link>
              <Link href="https://www.instagram.com/ravikishan.404/">
                <a className="btn__social ig" target="_blank">
                  <i className="fab fa-instagram"></i>
                </a>
              </Link>
              <Link href="https://wa.me/7061133910">
                <a className="btn__social wh" target="_blank">
                  <i className="fab fa-whatsapp"></i>
                </a>
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
};

export default Map;
