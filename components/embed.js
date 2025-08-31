import { Fragment } from 'react'
import { Popover, Transition } from '@headlessui/react'
import { MenuIcon, XIcon } from '@heroicons/react/outline'
import { ChevronRightIcon } from '@heroicons/react/solid'
import Image from 'next/image';
import IllLogo from '../public/assets/banner-image.png';
import Link from 'next/link';

// const navigation = [
//   { name: 'Product', href: '#' },
//   { name: 'Features', href: '#' },
//   { name: 'Marketplace', href: '#' },
//   { name: 'Company', href: '#' },
// ]

export default function Example() {
  return (
    <div className="relative overflow-hidden">
      {/* <Popover as="header" className="relative">
        <div className="bg-gray-900 pt-6 p-4">
          <nav className="relative max-w-7xl mx-auto flex items-center justify-between px-6" aria-label="Global">
            <div className="flex items-center flex-1">
              <div className="flex items-center justify-between w-full">
                <a href="#">
                  <span className="sr-only">Workflow</span>
                  <Image width={70} height={70} objectFit="cover" className="w-auto h-10" src={IllLogo} alt="banner image" />
                </a>
                <div className="-mr-2 flex items-center">
                  <Popover.Button className="bg-gray-900 rounded-md p-2 inline-flex items-center justify-center text-gray-400 hover:bg-gray-800 focus:outline-none focus:ring-2 focus-ring-inset focus:ring-white">
                    <span className="sr-only">Open main menu</span>
                    <MenuIcon className="h-6 w-6" aria-hidden="true" />
                  </Popover.Button>
                </div>
              </div>
              <div className="hidden space-x-8">
                {navigation.map((item) => (
                  <a key={item.name} href={item.href} className="text-base font-medium text-white hover:text-gray-300">
                    {item.name}
                  </a>
                ))}
              </div>
            </div>
            <div className="hidden">
              <a href="#" className="text-base font-medium text-white hover:text-gray-300">
                Log in
              </a>
              <a
                href="#"
                className="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md text-white bg-gray-600 hover:bg-gray-700">
                Start free trial
              </a>
            </div>
          </nav>
        </div>

        <Transition
          as={Fragment}
          enter="duration-150 ease-out"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="duration-100 ease-in"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95">
          <Popover.Panel focus className="absolute z-10 top-0 inset-x-0 p-4 transition transform origin-top">
            <div className="rounded-3xl shadow-md bg-white ring-1 ring-black ring-opacity-5 overflow-hidden">
              <div className="px-5 pt-4 flex items-center justify-between">
                <div>
                  <img className="h-8 w-auto" src="https://tailwindui.com/img/logos/workflow-mark-indigo-600.svg" alt="" />
                </div>
                <div className="-mr-2">
                  <Popover.Button className="bg-white rounded-md p-2 inline-flex items-center justify-center text-gray-400 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-600">
                    <span className="sr-only">Close menu</span>
                    <XIcon className="h-6 w-6" aria-hidden="true" />
                  </Popover.Button>
                </div>
              </div>
              <div className="pt-5 pb-6">
                <div className="px-2 space-y-1">
                  {navigation.map((item) => (
                    <a key={item.name} href={item.href} className="block px-3 py-2 rounded-md text-base font-medium text-gray-900 hover:bg-gray-50">
                      {item.name}
                    </a>
                  ))}
                </div>
                <div className="mt-6 px-5">
                  <Link href="#" className="block text-center w-full py-3 px-4 rounded-md shadow bg-indigo-600 text-white font-medium hover:bg-indigo-700">
                    Hire Me
                  </Link>
                </div>
                <div className="mt-6 px-5">
                  <p className="text-center text-base font-medium text-gray-500">
                    Existing customer?{' '}
                    <a href="#" className="text-gray-900 hover:underline">
                      Login
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </Popover.Panel>
        </Transition>
      </Popover> */}

      <main>
        <div className="pt-10 bg-gray-900 pt-16">
          <div className="mx-auto max-w-7xl">
            <div className="">
              <div className="mx-auto max-w-md px-4 max-w-2xl px-6 text-center">
                <div className="">
                  <a href="#projects" className="inline-flex items-center text-white bg-black rounded-full p-1 pr-2 text-base hover:text-gray-200">
                    <span className="px-3 py-0.5 text-white text-xs font-semibold leading-5 uppercase tracking-wide bg-indigo-500 rounded-full">
                      I&apos;m a builder
                    </span>
                    <span className="ml-4 text-sm">See My Projects</span>
                    <ChevronRightIcon className="ml-2 w-5 h-5 text-gray-500" aria-hidden="true" />
                  </a>
                  <h1 className="mt-4 text-4xl tracking-tight font-extrabold text-white mt-5 text-6xl">
                    <span className="block">Ravi Kishan</span>
                    <span className="block text-indigo-400">A full-stack developer</span>
                  </h1>
                  <p className="mt-3 text-base text-gray-300 mt-5 text-xl">
                  I am a Full Stack Developer with 1+ years of personal
                    project experience in the development of web applications. I
                    have worked on various projects using different
                    technologies. 
                  </p>
                  
                </div>
              </div>
              <div className="mt-12 -mb-48">
                <div className="mx-auto max-w-md px-4 max-w-2xl px-6">
                  {/* Illustration taken from Lucid Illustrations: https://lucid.pixsellz.io/ */}
                  <img className="w-full" src="https://tailwindui.com/img/component-images/cloud-illustration-indigo-400.svg" alt="" />
                </div>
              </div>
            </div>
            <div className="mx-auto max-w-md px-4 max-w-2xl px-6" style={{ height: 220 }} />

            <div>
              {/* Hero card */}
              <div className="relative">
                <div className="absolute inset-x-0 bottom-0 h-1/2" />
                <div className="max-w-7xl mx-auto px-6">
                  <div className="relative shadow-xl rounded-2xl overflow-hidden">
                    <div className="absolute inset-0">
                      <img
                        className="h-full w-full object-cover"
                        src="https://images.unsplash.com/photo-1521737852567-6949f3f9f2b5?ixid=MXwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHw%3D&ixlib=rb-1.2.1&auto=format&fit=crop&w=2830&q=80&sat=-100"
                        alt="People working on laptops"
                      />
                      <div className="absolute inset-0 bg-indigo-700 mix-blend-multiply" />
                    </div>
                    <div className="relative px-4 py-16 px-6 py-24">
                      <h1 className="text-center text-4xl font-extrabold tracking-tight text-5xl">
                        <span className="block text-white">Build your product</span>
                        <span className="block text-indigo-200">Fast & Interactive</span>
                      </h1>
                      <p className="mt-6 max-w-lg mx-auto text-center text-xl text-indigo-200 max-w-3xl">
                      I make websites that serve a purpose and bring value to your users.
            I also love building accessible, inclusive products. I make building
            easy and interesting.
                      </p>
                      <div className="mt-10 max-w-sm mx-auto max-w-none flex justify-center">
                        <div className="space-y-0 space-y-0 mx-auto inline-grid grid-cols-2 gap-5">
                          <a
                            href="#projects"
                            className="flex items-center justify-center px-4 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-indigo-700 bg-white hover:bg-indigo-50 px-8">
                            See My Projects
                          </a>
                          <a
                            href="#articles"
                            className="flex items-center justify-center px-4 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-500 bg-opacity-60 hover:bg-opacity-70 px-8">
                            See My Articles
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
