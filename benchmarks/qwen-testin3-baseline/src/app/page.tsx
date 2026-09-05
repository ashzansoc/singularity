import Features from "@/components/sections/Features";
import Waitlist from "@/components/sections/Waitlist";
import { Hero } from "@/components/sections/Hero";
import Footer from "@/components/layout/Footer";

export default function Home() {
  return (
    <>
      <Hero />
      <Features />
      <Waitlist />
      <Footer />
    </>
  );
}
