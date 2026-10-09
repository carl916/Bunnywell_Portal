# Whole portal region trial distributions

Complete readiness is the later of usable controls plus two animation frames and the final critical request. Visual and actionable times are separate. All durations are milliseconds; bytes are response body bytes reported by Chromium. Polling is counted in requests and bytes but excluded from readiness. Each journey has eight A/B pairs except Snags, which has one per profile. Negative paired B−A means Frankfurt was faster.

## Browser journeys

| Role and profile and journey | A p50 / p75 / min–max | B p50 / p75 / min–max | Paired B−A p50 / p75 / min–max | Faster pairs |
|---|---:|---:|---:|---:|
| admin/desktop/dashboard.cold | 3,952 / 4,040 / 3,371–4,388 | 2,406 / 2,420 / 2,347–2,949 | -1,543 / -1,051 / -2,038–-422 | 8/8 |
| admin/desktop/dashboard.repeat | 3,216 / 3,476 / 2,939–3,990 | 2,422 / 2,449 / 1,918–2,966 | -1,017 / -888 / -2,051–-4 | 8/8 |
| admin/desktop/dashboard.refresh | 2,785 / 2,962 / 2,500–3,215 | 1,616 / 1,743 / 1,493–1,787 | -1,169 / -901 / -1,574–-816 | 8/8 |
| admin/desktop/dashboard.building_change | 2,913 / 2,921 / 2,864–2,937 | 1,893 / 1,899 / 1,370–22,790 | -1,027 / -1,013 / -1,551–19,926 | 7/8 |
| admin/desktop/navigation.sales | 855 / 855 / 838–873 | 854 / 862 / 847–1,356 | -1 / 8 / -24–518 | 5/8 |
| admin/desktop/sale.open | 164 / 171 / 137–205 | 150 / 174 / 143–196 | -8 / 9 / -40–30 | 5/8 |
| admin/desktop/sale.reservation | 42 / 49 / 39–53 | 47 / 52 / 42–56 | 5 / 12 / -10–17 | 3/8 |
| admin/desktop/sale.exchange | 1,607 / 1,615 / 1,589–2,113 | 1,102 / 1,114 / 1,079–1,134 | -505 / -496 / -1,026–-468 | 8/8 |
| admin/desktop/sale.completion | 61 / 62 / 42–65 | 62 / 63 / 51–83 | 2 / 15 / -5–18 | 3/8 |
| admin/desktop/comments.open | 274 / 286 / 168–293 | 286 / 290 / 152–302 | 4 / 27 / -120–117 | 4/8 |
| admin/desktop/sale.return | 68 / 75 / 59–76 | 68 / 76 / 58–78 | 0 / 5 / -17–19 | 4/8 |
| admin/desktop/sale.another | 70 / 80 / 60–83 | 73 / 77 / 60–83 | 7 / 10 / -21–21 | 3/8 |
| admin/desktop/sale.browser_back | 35 / 39 / 28–40 | 39 / 40 / 27–41 | 0 / 4 / -8–13 | 4/8 |
| admin/desktop/navigation.snags | 9,001 / 9,001 / 9,001–9,001 | 10,621 / 10,621 / 10,621–10,621 | 1,620 / 1,620 / 1,620–1,620 | 0/1 |
| admin/desktop/navigation.rentals | 879 / 1,386 / 842–1,416 | 862 / 870 / 841–881 | -25 / -2 / -554–11 | 6/8 |
| admin/desktop/navigation.setup | 647 / 668 / 623–802 | 676 / 749 / 632–792 | 46 / 87 / -156–161 | 2/8 |
| admin/desktop/setup.units | 618 / 740 / 547–835 | 604 / 626 / 575–659 | -11 / 42 / -259–72 | 4/8 |
| admin/desktop/setup.users | 580 / 588 / 564–728 | 593 / 640 / 565–672 | 5 / 67 / -161–109 | 3/8 |
| admin/desktop/navigation.dashboard | 2,939 / 3,417 / 2,908–4,410 | 1,905 / 1,912 / 1,870–2,395 | -1,040 / -1,005 / -2,015–-1,002 | 8/8 |
| admin/desktop/dashboard.task_to_sale | 870 / 891 / 864–1,388 | 870 / 872 / 849–888 | -10 / 6 / -517–24 | 5/8 |
| admin/mobile/dashboard.cold | 7,227 / 7,390 / 6,689–7,779 | 5,676 / 5,926 / 5,543–6,233 | -1,510 / -1,266 / -2,236–-473 | 8/8 |
| admin/mobile/dashboard.repeat | 4,094 / 4,339 / 3,818–4,890 | 2,820 / 2,946 / 2,808–3,317 | -1,042 / -1,008 / -2,071–-554 | 8/8 |
| admin/mobile/dashboard.refresh | 2,919 / 2,968 / 2,620–3,200 | 1,861 / 1,939 / 1,696–2,088 | -1,070 / -886 / -1,358–-842 | 8/8 |
| admin/mobile/dashboard.building_change | 3,036 / 3,040 / 3,011–3,546 | 1,997 / 2,005 / 1,518–2,018 | -1,041 / -1,028 / -1,549–-1,012 | 8/8 |
| admin/mobile/navigation.sales | 1,445 / 1,470 / 1,435–1,507 | 1,469 / 1,474 / 1,451–1,490 | 31 / 34 / -56–51 | 3/8 |
| admin/mobile/sale.open | 185 / 196 / 160–206 | 202 / 221 / 172–261 | 18 / 38 / -34–66 | 1/8 |
| admin/mobile/sale.reservation | 179 / 183 / 111–190 | 184 / 189 / 103–198 | 2 / 7 / -72–16 | 3/8 |
| admin/mobile/sale.exchange | 1,801 / 1,822 / 1,782–2,294 | 1,293 / 1,302 / 1,276–3,361 | -503 / -493 / -1,004–1,577 | 7/8 |
| admin/mobile/sale.completion | 106 / 108 / 89–140 | 106 / 114 / 103–142 | -0 / 6 / -3–35 | 4/8 |
| admin/mobile/comments.open | 1,354 / 1,379 / 1,248–1,583 | 1,350 / 1,368 / 1,254–1,408 | -13 / 34 / -326–120 | 4/8 |
| admin/mobile/sale.return | 125 / 125 / 118–126 | 120 / 122 / 116–123 | -3 / -2 / -10–4 | 7/8 |
| admin/mobile/sale.another | 144 / 149 / 130–196 | 147 / 151 / 131–154 | 0 / 8 / -46–15 | 4/8 |
| admin/mobile/sale.browser_back | 73 / 75 / 61–79 | 65 / 67 / 59–68 | -9 / 0 / -15–6 | 6/8 |
| admin/mobile/navigation.snags | 48,396 / 48,396 / 48,396–48,396 | 48,343 / 48,343 / 48,343–48,343 | -53 / -53 / -53–-53 | 1/1 |
| admin/mobile/navigation.rentals | 1,448 / 1,460 / 930–1,510 | 930 / 940 / 913–1,008 | -507 / -16 / -551–19 | 7/8 |
| admin/mobile/navigation.setup | 1,322 / 1,361 / 1,289–1,406 | 1,309 / 1,352 / 1,273–1,364 | -20 / 17 / -110–75 | 4/8 |
| admin/mobile/setup.units | 1,220 / 1,265 / 1,197–1,408 | 1,222 / 1,230 / 1,168–1,297 | -15 / 11 / -181–21 | 5/8 |
| admin/mobile/setup.users | 1,245 / 1,258 / 1,220–1,291 | 1,255 / 1,280 / 1,234–1,388 | 12 / 28 / -40–153 | 3/8 |
| admin/mobile/navigation.dashboard | 3,513 / 3,522 / 3,011–3,555 | 1,978 / 1,982 / 1,949–2,010 | -1,520 / -1,078 / -1,598–-1,027 | 8/8 |
| admin/mobile/dashboard.task_to_sale | 1,431 / 1,433 / 1,388–1,456 | 1,414 / 1,437 / 1,377–1,467 | -8 / 9 / -55–61 | 5/8 |
| conveyancer/desktop/sales.cold | 2,767 / 2,974 / 2,331–3,088 | 1,548 / 1,698 / 1,443–1,857 | -1,166 / -855 / -1,578–-474 | 8/8 |
| conveyancer/desktop/sales.repeat | 2,216 / 2,329 / 2,086–2,391 | 1,211 / 1,231 / 1,095–1,261 | -1,036 / -909 / -1,296–-826 | 8/8 |
| conveyancer/desktop/register.refresh | 2,170 / 2,291 / 1,995–2,412 | 1,091 / 1,118 / 1,020–1,218 | -1,047 / -954 / -1,307–-911 | 8/8 |
| conveyancer/desktop/sales.building_change | 1,698 / 1,919 / 1,573–2,045 | 783 / 811 / 716–949 | -900 / -846 / -1,267–-754 | 8/8 |
| conveyancer/desktop/sale.open | 879 / 882 / 860–891 | 390 / 871 / 362–897 | -485 / -9 / -502–17 | 7/8 |
| conveyancer/desktop/sale.reservation | 51 / 51 / 46–54 | 50 / 52 / 43–54 | 0 / 1 / -8–2 | 4/8 |
| conveyancer/desktop/sale.exchange | 1,611 / 1,632 / 1,598–2,629 | 1,104 / 1,110 / 1,090–1,120 | -506 / -498 / -1,539–-488 | 8/8 |
| conveyancer/desktop/sale.completion | 52 / 54 / 46–70 | 52 / 54 / 51–69 | 0 / 1 / -1–5 | 3/8 |
| conveyancer/desktop/comments.open | 156 / 165 / 149–173 | 153 / 157 / 148–263 | -3 / 8 / -21–109 | 4/8 |
| conveyancer/desktop/sale.return | 77 / 77 / 75–78 | 76 / 77 / 75–78 | -1 / -0 / -2–4 | 7/8 |
| conveyancer/desktop/sale.another | 885 / 889 / 846–891 | 385 / 859 / 362–879 | -503 / -7 / -516–14 | 6/8 |
| conveyancer/desktop/sale.browser_back | 43 / 50 / 34–51 | 49 / 50 / 40–51 | 5 / 12 / -11–14 | 1/8 |
| conveyancer/mobile/sales.cold | 5,715 / 5,849 / 5,494–6,508 | 4,756 / 4,829 / 4,606–5,041 | -946 / -834 / -1,901–-650 | 8/8 |
| conveyancer/mobile/sales.repeat | 2,862 / 3,026 / 2,751–3,206 | 2,033 / 2,105 / 1,912–2,219 | -862 / -719 / -1,163–-532 | 8/8 |
| conveyancer/mobile/register.refresh | 2,670 / 2,767 / 2,408–3,177 | 1,627 / 1,658 / 1,474–1,691 | -1,140 / -884 / -1,670–-733 | 8/8 |
| conveyancer/mobile/sales.building_change | 1,917 / 2,031 / 1,638–2,174 | 933 / 1,031 / 791–1,154 | -897 / -801 / -1,383–-617 | 8/8 |
| conveyancer/mobile/sale.open | 933 / 942 / 915–952 | 931 / 947 / 902–992 | -7 / 21 / -32–43 | 5/8 |
| conveyancer/mobile/sale.reservation | 96 / 102 / 75–110 | 102 / 104 / 76–156 | 5 / 19 / -25–58 | 3/8 |
| conveyancer/mobile/sale.exchange | 2,354 / 3,024 / 1,797–3,827 | 1,878 / 2,498 / 1,262–2,714 | -461 / 688 / -2,520–906 | 5/8 |
| conveyancer/mobile/sale.completion | 96 / 99 / 81–132 | 96 / 98 / 82–117 | -0 / 1 / -15–3 | 4/8 |
| conveyancer/mobile/comments.open | 1,348 / 1,385 / 1,303–1,464 | 1,329 / 1,358 / 1,275–1,363 | -37 / -10 / -107–16 | 6/8 |
| conveyancer/mobile/sale.return | 103 / 111 / 89–141 | 106 / 109 / 102–122 | 2 / 7 / -25–18 | 3/8 |
| conveyancer/mobile/sale.another | 926 / 936 / 895–940 | 921 / 925 / 897–947 | -3 / 12 / -39–15 | 4/8 |
| conveyancer/mobile/sale.browser_back | 69 / 72 / 65–87 | 65 / 69 / 61–73 | -1 / -0 / -26–8 | 6/8 |

## Visual readiness and transferred data

| Journey | Visual A / B p50 | Actionable A / B p50 | Requests A / B p50 | Bytes A / B p50 |
|---|---:|---:|---:|---:|
| admin/desktop/dashboard.cold | 1,017 / 1,049 | 3,952 / 2,406 | 33 / 33 | 526,851 / 526,904 |
| admin/desktop/dashboard.repeat | 3,195 / 2,409 | 3,216 / 2,422 | 33 / 33 | 44,055 / 44,038 |
| admin/desktop/dashboard.refresh | 2,752 / 1,581 | 2,785 / 1,616 | 1 / 1 | 19,639 / 19,642 |
| admin/desktop/dashboard.building_change | 2,891 / 1,872 | 2,913 / 1,893 | 2 / 2 | 19,416 / 19,407 |
| admin/desktop/navigation.sales | 837 / 840 | 855 / 854 | 12 / 12 | 107,169 / 107,189 |
| admin/desktop/sale.open | 64 / 65 | 91 / 90 | 4 / 4 | 3,251 / 3,251 |
| admin/desktop/sale.reservation | 17 / 22 | 42 / 47 | 0 / 0 | 0 / 0 |
| admin/desktop/sale.exchange | 1,585 / 1,077 | 1,607 / 1,102 | 4 / 4 | 9,136 / 9,130 |
| admin/desktop/sale.completion | 37 / 41 | 61 / 62 | 0 / 0 | 0 / 0 |
| admin/desktop/comments.open | 251 / 260 | 274 / 286 | 0 / 0 | 0 / 0 |
| admin/desktop/sale.return | 41 / 42 | 68 / 68 | 1 / 1 | 847 / 848 |
| admin/desktop/sale.another | 44 / 50 | 70 / 73 | 2 / 2 | 846 / 845 |
| admin/desktop/sale.browser_back | 8 / 8 | 35 / 39 | 1 / 1 | 847 / 847 |
| admin/desktop/navigation.snags | 1,860 / 1,855 | 1,893 / 1,882 | 40 / 40 | 25,004,393 / 25,004,332 |
| admin/desktop/navigation.rentals | 858 / 851 | 879 / 862 | 3 / 3 | 10,581 / 10,575 |
| admin/desktop/navigation.setup | 35 / 47 | 67 / 77 | 19 / 19 | 112,171 / 112,166 |
| admin/desktop/setup.units | 31 / 29 | 57 / 59 | 17 / 17 | 101,732 / 101,723 |
| admin/desktop/setup.users | 39 / 38 | 66 / 66 | 17 / 17 | 99,883 / 99,884 |
| admin/desktop/navigation.dashboard | 2,915 / 1,879 | 2,939 / 1,905 | 2 / 2 | 19,399 / 19,395 |
| admin/desktop/dashboard.task_to_sale | 856 / 845 | 870 / 870 | 14 / 14 | 109,206 / 109,225 |
| admin/mobile/dashboard.cold | 3,731 / 3,989 | 7,227 / 5,676 | 33 / 33 | 526,745 / 526,503 |
| admin/mobile/dashboard.repeat | 4,062 / 2,790 | 4,094 / 2,820 | 33 / 33 | 44,067 / 44,051 |
| admin/mobile/dashboard.refresh | 2,873 / 1,808 | 2,919 / 1,861 | 1 / 1 | 19,629 / 19,644 |
| admin/mobile/dashboard.building_change | 3,011 / 1,964 | 3,036 / 1,997 | 2 / 2 | 19,394 / 19,405 |
| admin/mobile/navigation.sales | 1,423 / 1,431 | 1,445 / 1,469 | 12 / 12 | 104,844 / 104,851 |
| admin/mobile/sale.open | 151 / 164 | 185 / 202 | 2 / 2 | -2 / -2 |
| admin/mobile/sale.reservation | 149 / 152 | 179 / 184 | 0 / 0 | 0 / 0 |
| admin/mobile/sale.exchange | 1,778 / 1,274 | 1,801 / 1,293 | 1 / 1 | 5,941 / 5,940 |
| admin/mobile/sale.completion | 75 / 77 | 106 / 106 | 0 / 0 | 0 / 0 |
| admin/mobile/comments.open | 1,327 / 1,316 | 1,354 / 1,350 | 2 / 2 | 2,406 / 2,405 |
| admin/mobile/sale.return | 85 / 83 | 125 / 120 | 1 / 1 | 848 / 845 |
| admin/mobile/sale.another | 117 / 116 | 144 / 147 | 2 / 2 | -2 / -2 |
| admin/mobile/sale.browser_back | 36 / 36 | 73 / 65 | 1 / 1 | 846 / 847 |
| admin/mobile/navigation.snags | 2,460 / 2,484 | 2,502 / 2,522 | 30 / 30 | 9,367,442 / 9,367,312 |
| admin/mobile/navigation.rentals | 1,434 / 918 | 1,448 / 930 | 3 / 3 | 10,573 / 10,575 |
| admin/mobile/navigation.setup | 167 / 150 | 200 / 186 | 19 / 19 | 112,182 / 112,173 |
| admin/mobile/setup.units | 101 / 102 | 130 / 127 | 17 / 17 | 101,735 / 101,725 |
| admin/mobile/setup.users | 124 / 146 | 160 / 187 | 17 / 17 | 99,890 / 99,878 |
| admin/mobile/navigation.dashboard | 3,481 / 1,947 | 3,513 / 1,978 | 2 / 2 | 19,405 / 19,400 |
| admin/mobile/dashboard.task_to_sale | 1,406 / 1,397 | 1,431 / 1,414 | 12 / 12 | 104,878 / 106,143 |
| conveyancer/desktop/sales.cold | 1,031 / 1,021 | 2,767 / 1,548 | 33 / 33 | 514,180 / 514,181 |
| conveyancer/desktop/sales.repeat | 2,185 / 1,174 | 2,216 / 1,211 | 33 / 33 | 31,257 / 31,253 |
| conveyancer/desktop/register.refresh | 2,137 / 1,068 | 2,170 / 1,091 | 15 / 15 | 36,576 / 36,568 |
| conveyancer/desktop/sales.building_change | 1,669 / 754 | 1,698 / 783 | 2 / 2 | 6,736 / 6,732 |
| conveyancer/desktop/sale.open | 861 / 342 | 879 / 360 | 15 / 15 | 17,745 / 17,738 |
| conveyancer/desktop/sale.reservation | 27 / 26 | 51 / 50 | 0 / 0 | 0 / 0 |
| conveyancer/desktop/sale.exchange | 1,589 / 1,081 | 1,611 / 1,104 | 4 / 4 | 7,684 / 7,681 |
| conveyancer/desktop/sale.completion | 30 / 30 | 52 / 52 | 0 / 0 | 0 / 0 |
| conveyancer/desktop/comments.open | 132 / 129 | 156 / 153 | 0 / 0 | 0 / 0 |
| conveyancer/desktop/sale.return | 43 / 45 | 77 / 76 | 1 / 1 | 846 / 846 |
| conveyancer/desktop/sale.another | 870 / 350 | 885 / 378 | 15 / 15 | 17,748 / 17,747 |
| conveyancer/desktop/sale.browser_back | 12 / 12 | 43 / 49 | 1 / 1 | 846 / 846 |
| conveyancer/mobile/sales.cold | 3,938 / 3,724 | 5,715 / 4,756 | 33 / 33 | 514,109 / 514,079 |
| conveyancer/mobile/sales.repeat | 2,828 / 1,998 | 2,862 / 2,033 | 33 / 33 | 31,288 / 31,276 |
| conveyancer/mobile/register.refresh | 2,644 / 1,593 | 2,670 / 1,627 | 15 / 15 | 36,568 / 36,563 |
| conveyancer/mobile/sales.building_change | 1,887 / 901 | 1,917 / 933 | 2 / 2 | 6,732 / 6,730 |
| conveyancer/mobile/sale.open | 919 / 912 | 933 / 931 | 13 / 13 | 15,326 / 15,328 |
| conveyancer/mobile/sale.reservation | 72 / 74 | 96 / 102 | 0 / 0 | 0 / 0 |
| conveyancer/mobile/sale.exchange | 2,329 / 1,857 | 2,354 / 1,878 | 1 / 1 | 5,951 / 5,949 |
| conveyancer/mobile/sale.completion | 64 / 64 | 96 / 96 | 0 / 0 | 0 / 0 |
| conveyancer/mobile/comments.open | 1,321 / 1,303 | 1,348 / 1,329 | 2 / 2 | 2,402 / 2,402 |
| conveyancer/mobile/sale.return | 87 / 87 | 103 / 106 | 1 / 1 | 845 / 846 |
| conveyancer/mobile/sale.another | 908 / 904 | 926 / 921 | 13 / 13 | 15,334 / 15,338 |
| conveyancer/mobile/sale.browser_back | 36 / 33 | 69 / 65 | 1 / 1 | 846 / 845 |

## Direct API diagnostics

Eight alternating pairs per endpoint, measured separately from the final browser batch. API time includes response body transfer; API bytes are decoded UTF-8 JSON size, not compressed wire size. Database spans are sums of overlapping remote fetches, not database CPU time or additive wall time. Uninstrumented endpoints have no inferred server breakdown.

| Role and endpoint and scope | A p50 / p75 / min–max | B p50 / p75 / min–max | Paired B−A p50 / p75 / min–max | Bytes A / B p50 |
|---|---:|---:|---:|---:|
| admin /api/dashboard all | 2,857 / 2,998 / 2,695–3,512 | 1,507 / 1,620 / 1,242–1,868 | -1,359 / -1,215 / -1,911–-827 | 286,763 / 286,763 |
| admin /api/dashboard single | 2,534 / 2,930 / 2,305–3,239 | 1,296 / 1,351 / 1,193–1,376 | -1,271 / -1,025 / -2,009–-947 | 274,844 / 274,844 |
| admin /api/rentals/tenancies default | 553 / 687 / 489–722 | 165 / 192 / 140–226 | -390 / -341 / -558–-263 | 28,558 / 28,558 |
| admin /api/rentals/rent-risk default | 563 / 694 / 493–713 | 202 / 221 / 148–246 | -387 / -334 / -504–-298 | 26,720 / 26,720 |
| admin /api/units/allocation default | 548 / 726 / 485–768 | 195 / 215 / 157–249 | -375 / -322 / -572–-274 | 11,196 / 11,196 |
| conveyancer /api/sales/register all | 1,817 / 1,896 / 1,674–2,111 | 862 / 965 / 696–1,047 | -939 / -853 / -1,415–-725 | 83,179 / 83,179 |
| conveyancer /api/sales/register single | 1,645 / 1,734 / 1,438–2,009 | 707 / 809 / 643–1,148 | -940 / -767 / -1,324–-353 | 52,538 / 52,538 |

## Server remote spans

| Endpoint and scope | Route A / B p50 | Auth A / B p50 | Overlapping DB spans A / B p50 |
|---|---:|---:|---:|
| admin /api/dashboard all | 2,611 / 1,402 | 130 / 49 | 6,603 / 4,015 |
| admin /api/dashboard single | 2,328 / 1,195 | 112 / 24 | 5,972 / 3,249 |
| admin /api/rentals/tenancies default | — / — | — / — | — / — |
| admin /api/rentals/rent-risk default | — / — | — / — | — / — |
| admin /api/units/allocation default | — / — | — / — | — / — |
| conveyancer /api/sales/register all | 1,586 / 747 | 112 / 40 | 2,511 / 1,109 |
| conveyancer /api/sales/register single | 1,516 / 642 | 115 / 32 | 2,426 / 993 |
