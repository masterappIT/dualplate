<template>
  <view class="approval-preview">
    <view class="approval-flip-stage" role="button" tabindex="0" :aria-label="tapLabel || (isFlipped ? '批文卡背面，點擊翻到正面' : '批文卡正面，點擊翻到背面')" @click="toggleSide" @keydown.enter.prevent="toggleSide" @keydown.space.prevent="toggleSide">
      <view class="approval-flip-inner" :class="{ 'is-flipped': isFlipped }">
        <view class="approval-face approval-face--front" :aria-hidden="isFlipped">
      <svg class="approval-svg" viewBox="0 0 1013 643" role="img" aria-label="批文卡正面">
        <defs>
          <linearGradient id="front-paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5f8f8"/><stop offset=".52" stop-color="#e9f4f7"/><stop offset="1" stop-color="#e9eef0"/></linearGradient>
          <pattern id="front-micro" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M0 18C11 7 22 29 38 15M-8 35C8 24 20 47 45 29" fill="none" stroke="#829da4" stroke-width=".65" opacity=".10"/><circle cx="8" cy="7" r="1" fill="#708e95" opacity=".13"/><circle cx="29" cy="30" r="1" fill="#708e95" opacity=".10"/></pattern>
          <pattern id="front-security" width="95" height="68" patternUnits="userSpaceOnUse"><path d="M10 60C13 27 41 12 55 42c12 25 26 16 31-11" fill="none" stroke="#7ad4df" stroke-width="2" opacity=".3"/><path d="M0 35c20-20 39-19 59 0 11 10 21 11 36-2" fill="none" stroke="#dfcf78" stroke-width="3" opacity=".15"/></pattern>
          <clipPath id="front-company-clip"><rect x="202" y="205" width="750" height="75"/></clipPath>
          <clipPath id="front-contractor-clip"><rect x="198" y="365" width="770" height="84"/></clipPath>
        </defs>
        <rect x="2" y="2" width="1009" height="639" rx="28" fill="url(#front-paper)" stroke="#aeb9b8" stroke-width="2"/>
        <rect x="8" y="8" width="997" height="627" rx="23" fill="url(#front-micro)"/><path d="M10 33Q14 9 43 9H970Q996 10 1003 35" fill="none" stroke="#1b2729" stroke-width="4" opacity=".78"/><path d="M10 608Q15 631 40 636H970Q998 633 1004 608" fill="none" stroke="#d9dedc" stroke-width="4" opacity=".85"/>
        <rect x="8" y="155" width="997" height="475" fill="url(#front-security)" opacity=".85"/>

<g fill="none" stroke="#53bdca" stroke-width="1.3" opacity=".54"><path d="M874 480L903 483L906 478Z"/><path d="M488 475L494 478L489 480Z"/><path d="M860 478L869 479L871 477L870 474L864 473Z"/><path d="M64 464L73 470L74 475L79 475L81 472L72 464Z"/><path d="M954 451L956 452L955 458L951 456Z"/><path d="M680 450L687 451L696 457L697 462L708 466L719 466L724 471L764 472L768 475L744 478L742 476L727 477L722 472L707 472L704 466L697 466L681 454Z"/><path d="M956 449L963 448L962 451Z"/><path d="M813 448L813 451L819 452L830 463L840 463L842 470L856 474L855 468L841 464L826 449Z"/><path d="M672 446L681 445L679 449Z"/><path d="M158 449L153 444L149 452L142 455L141 460L123 469L122 467L120 472L90 475L85 478L119 477L128 466L136 467L148 457L149 453Z"/><path d="M82 440L71 454L58 451L57 457L62 461L71 457L73 452L83 446Z"/><path d="M163 434L158 435L158 442L163 441Z"/><path d="M971 444L955 442L953 440L958 433L954 432L935 451L922 455L919 459L896 467L872 467L872 472L893 474L905 470L920 470L928 463L939 461L945 451L950 458L946 464L938 466L935 472L940 473L944 467L951 466L961 459Z"/><path d="M664 442L665 448L678 459L697 471L704 471L709 476L722 479L767 479L769 476L791 473L797 464L812 458L812 453L807 452L791 467L771 472L766 466L749 466L742 462L731 463L710 448L698 443L689 432L679 430L679 437Z"/><path d="M236 425L232 429L235 433L237 448L234 469L217 485L215 491L211 481L199 470L195 470L194 463L184 457L184 448L178 436L181 426L175 426L175 446L180 449L185 464L193 468L200 479L205 480L204 499L212 499L229 484L233 478L235 465L240 462L240 427Z"/><path d="M446 416L446 431L451 431L451 416Z"/><path d="M367 447L370 463L374 464L372 446L379 441L381 447L378 448L381 462L392 461L394 463L393 454L399 451L405 458L408 458L410 452L432 447L435 444L455 443L457 445L455 448L441 452L439 456L438 454L434 457L431 463L410 476L394 475L391 478L378 465L376 466L377 472L384 473L385 478L418 479L428 474L429 470L440 463L441 459L455 454L463 458L471 476L474 472L480 482L519 487L522 484L535 484L538 479L548 478L558 468L558 465L563 463L568 456L569 430L567 426L564 428L564 447L554 460L552 468L542 474L536 473L529 479L521 478L520 480L500 478L513 474L524 465L527 457L526 448L529 445L553 447L559 435L556 428L553 428L551 443L542 437L540 431L522 439L521 446L515 449L516 454L520 454L520 464L514 464L511 468L502 466L493 469L489 467L487 471L484 465L478 462L476 454L464 440L458 436L440 436L439 431L425 431L409 443L407 448L394 445L392 452L386 448L390 446L385 440L395 431L407 425L412 416L403 416L397 422L378 428L377 435L372 438L372 444Z"/><path d="M104 412L102 413L106 419L101 421L102 425L107 422Z"/><path d="M99 412L94 415L89 424L86 423L84 431L86 437L88 432L99 423L94 419L99 417L96 415Z"/><path d="M75 411L74 423L77 419Z"/><path d="M54 410L54 425L56 426L58 420L55 418Z"/><path d="M410 405L409 408L418 416L418 407Z"/><path d="M102 405L99 404L95 409L99 409Z"/><path d="M468 400L467 403L474 410L470 404L472 400Z"/><path d="M188 401L186 400L181 406L187 405Z"/><path d="M481 399L486 404L482 412L489 417L491 423L500 415L497 413L500 410L499 403L494 402L490 406L488 399Z"/><path d="M447 399L447 404L450 404L451 400Z"/><path d="M352 395L345 404L345 410L349 414L352 410Z"/><path d="M571 392L561 395L557 401L561 403L565 399L570 399Z"/><path d="M858 388L862 396L859 400L855 400L854 395Z"/><path d="M167 384L161 384L153 404L146 405L149 414L144 420L151 421L139 423L138 427L135 422L128 422L127 424L135 429L129 434L122 432L119 435L109 434L106 437L110 441L105 447L106 452L112 451L120 455L132 447L130 442L152 425L157 408L162 411L165 418L154 432L167 433L172 430L168 416L168 426L165 426L166 414L162 414L165 408L161 403L162 397L166 397L166 405L168 401L170 402L169 412L176 413L178 420L175 423L179 422L184 409L171 408L177 406L168 398Z"/><path d="M702 377L712 373L737 381L735 384L725 384L705 380Z"/><path d="M66 375L66 378L74 383L72 375Z"/><path d="M111 370L121 369L123 374L115 375Z"/><path d="M255 369L242 372L239 376L216 375L212 377L217 380L239 380L243 376L251 376L252 372L249 371Z"/><path d="M361 375L362 379L368 382L370 373L376 370L378 376L391 379L397 376L412 383L426 384L439 395L442 389L445 390L446 383L443 379L438 380L414 370L400 369L385 372L381 368L368 368Z"/><path d="M503 365L493 369L493 393L496 397L501 394L500 385L509 377Z"/><path d="M55 361L54 366L57 372L63 372L64 369L59 367Z"/><path d="M408 350L410 348L416 350L414 352Z"/><path d="M178 345L178 350L173 352L172 350Z"/><path d="M770 318L766 322L764 334L764 366L767 369L767 375L772 377L772 369L768 367L768 337L773 321Z"/><path d="M60 317L64 320L71 318L67 315Z"/><path d="M577 304L584 310L585 318L604 337L604 360L600 373L596 367L596 346L599 337L593 337L584 332L569 335L559 344L549 347L538 368L535 381L532 374L534 356L540 344L549 337L552 319L558 316L561 307L570 309Z"/><path d="M184 303L180 305L182 312Z"/><path d="M836 305L845 318L846 326L852 336L854 370L849 385L849 401L842 407L845 411L856 411L858 415L864 415L874 405L885 403L889 399L903 398L905 389L937 387L944 380L942 374L922 371L921 375L936 375L937 381L935 383L905 384L906 379L890 379L888 384L874 387L874 392L879 388L904 383L905 387L901 390L902 392L898 396L873 399L866 392L872 373L872 321L865 320L869 330L870 351L869 366L862 380L859 371L862 366L860 336L851 319L858 308L866 315L867 302L858 298L849 310L841 310L840 305Z"/><path d="M58 298L52 301L44 321L44 341L46 350L50 353L49 320L52 318L52 313L60 306Z"/><path d="M814 292L810 292L802 303L796 305L794 312L786 306L781 297L778 297L774 304L775 310L777 306L783 309L782 334L779 343L776 344L779 361L777 374L783 395L781 396L776 391L774 377L770 391L777 400L775 403L762 400L759 391L760 384L753 383L747 377L742 378L732 372L697 370L695 367L688 372L697 378L694 383L730 388L743 383L745 391L730 391L727 394L681 394L741 395L781 416L783 420L787 420L789 417L786 413L792 409L784 367L788 337L791 335L792 324Z"/><path d="M182 291L180 298L184 301L185 293Z"/><path d="M820 284L817 290L823 291L825 297L832 300L834 297L824 288L823 284Z"/><path d="M376 352L378 361L394 354L407 354L410 357L424 355L430 361L450 370L453 366L449 353L452 351L449 335L452 320L455 333L458 331L461 334L464 353L462 358L468 364L467 369L472 371L472 379L467 382L475 385L481 397L487 397L485 384L488 373L485 352L488 346L486 328L488 307L493 305L506 309L510 315L514 315L520 321L521 329L526 329L526 341L532 350L529 353L530 366L526 369L525 374L526 388L520 392L522 398L541 383L541 375L548 367L548 361L553 355L552 351L570 340L581 341L589 346L590 370L581 381L581 393L584 394L586 388L600 383L608 367L609 337L605 334L604 327L593 318L590 305L584 301L569 301L553 309L545 321L542 334L535 335L530 313L521 316L515 308L508 305L512 302L520 302L522 310L526 304L520 295L505 290L504 285L489 284L488 280L495 278L494 275L470 273L451 280L482 280L485 283L480 287L493 288L511 298L509 302L490 300L484 305L483 315L480 318L476 316L474 318L480 320L484 337L479 347L481 356L478 368L474 366L473 357L466 353L469 351L467 333L455 315L446 316L443 335L440 335L438 323L440 307L451 293L464 290L466 286L458 283L455 288L449 288L442 293L441 302L437 304L437 318L434 320L430 336L434 341L433 346L430 347L426 339L423 344L394 341L383 351Z"/><path d="M176 265L179 286L183 287L181 265Z"/><path d="M135 265L130 278L121 288L121 302L118 305L116 321L121 326L121 330L116 335L110 336L110 328L103 323L87 319L73 320L74 323L103 328L120 353L121 366L105 370L98 363L90 344L87 348L82 344L76 347L73 366L77 361L82 368L87 369L86 364L88 363L94 372L103 374L104 378L121 384L137 386L136 392L122 392L119 396L106 396L104 393L89 391L85 386L90 394L103 398L97 401L109 403L102 409L106 406L107 410L113 410L108 414L110 418L116 409L122 409L128 415L129 406L121 405L116 408L109 402L110 399L135 396L151 389L154 384L153 374L161 368L168 374L168 381L200 407L198 412L205 417L202 427L200 421L198 422L198 427L201 427L204 435L201 445L206 443L213 447L223 439L218 433L220 427L211 422L203 401L190 385L182 382L184 380L200 382L200 377L185 375L183 378L180 373L170 372L168 368L177 362L191 363L194 369L209 374L210 368L187 353L201 348L216 348L226 351L232 358L245 346L237 342L239 336L235 333L224 335L215 342L178 345L194 328L217 320L235 319L240 323L258 325L258 328L263 330L281 351L279 359L266 358L266 363L279 363L282 367L287 368L286 372L288 372L289 363L280 340L271 334L272 331L266 329L258 321L232 315L218 315L208 320L196 321L191 327L180 331L170 340L169 347L161 352L160 367L155 368L150 352L178 325L180 320L174 320L167 330L148 341L145 338L146 321L153 304L164 302L156 288L146 291L138 290L138 293L144 297L136 302L140 309L140 319L135 338L142 362L140 368L138 363L137 366L145 375L142 377L133 375L126 367L126 357L129 355L136 361L137 354L131 351L126 342L121 320L122 305L125 303L127 289L136 277L136 272L142 270L145 265Z"/></g>
        <defs><linearGradient id="front-band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e4d478" stop-opacity="0"/><stop offset=".43" stop-color="#c8dba0" stop-opacity=".45"/><stop offset=".66" stop-color="#e4dc82" stop-opacity=".38"/><stop offset="1" stop-color="#d2e2b3" stop-opacity="0"/></linearGradient></defs>
        <rect x="9" y="349" width="995" height="112" fill="url(#front-band)"/>
        <g fill="none" stroke="#5bc3d1" stroke-linecap="round" opacity=".43">
          <path d="M1 404C52 389 65 331 99 333c42 2 37 101 84 102 49 1 43-89 87-94 49-6 47 93 98 93 48 0 54-105 103-108 53-4 49 111 101 111 51 0 57-99 109-100 48-1 51 90 103 91 52 1 57-94 108-98 51-4 48 99 104 100 47 1 62-58 117-54" stroke-width="1.6"/>
          <path d="M2 441C51 427 65 354 108 355c47 1 42 88 84 87 45-2 42-96 91-99 47-3 44 90 94 90 51 0 48-105 101-108 49-3 50 106 103 106 48 0 48-91 99-93 52-2 54 86 107 86 53 0 59-82 108-85 55-4 58 100 119 95" stroke-width="1.2"/>
          <path d="M0 365C69 337 92 451 160 442c62-8 57-137 121-143 65-6 56 144 124 139 62-4 54-135 119-141 69-7 60 143 127 143 59 0 57-130 122-135 64-5 56 135 122 136 53 1 60-75 119-68" stroke-width=".9" opacity=".8"/>
          <path d="M0 379C80 359 91 463 163 460c65-3 60-131 121-132 66-1 57 132 123 131 63-1 56-126 119-130 69-4 60 130 126 131 63 1 59-127 124-126 65 1 59 133 121 129 51-3 69-77 117-71" stroke-width=".85" opacity=".7"/>
          <path d="M3 418C93 429 105 319 174 317c67-3 71 121 135 125 67 4 66-124 132-124 69 0 65 122 132 127 68 4 68-125 136-129 70-3 68 123 135 124 65 0 92-98 169-76" stroke-width=".8" opacity=".7"/>
          <path d="M1 457C94 455 113 383 170 386c70 4 72 76 135 76 67 0 72-79 136-76 66 4 71 79 134 77 65-3 66-78 134-80 72-2 72 81 139 80 67-1 99-59 165-61" stroke-width="1" opacity=".7"/>
        </g>
        <path d="M12 153H1001" stroke="#263b41" stroke-width="2" opacity=".8"/>
        <path d="M10 155C122 175 204 146 303 160s169 17 268 1 205-16 423 3" fill="none" stroke="#7199a0" stroke-width="1" opacity=".35"/>
        <g transform="translate(56 65)"><rect width="81" height="47" rx="3" fill="#882038"/><path d="M6 6h69v35H6zM40 8v32M8 23h65" fill="none" stroke="#db9a9d" stroke-width="1" opacity=".62"/><circle cx="40" cy="23" r="11" fill="none" stroke="#e5b7b8" stroke-width="2"/></g>

      </svg>
      <view class="card-layer front-layer">
        <text class="card-title">粤港澳机动车辆往来及驾驶人驾车批准通知书</text>
        <view class="card-row front-row front-number"><text class="card-label">编　　号:</text><text class="card-value number-value">{{ data.cardNumber }}</text></view>
        <view class="card-row front-row front-company"><text class="card-label">商　　号:</text><text class="card-value">{{ data.company }}</text></view>
        <view class="card-row front-row front-contractor"><text class="card-label">内承单位:</text><text class="card-value">{{ data.contractor }}</text></view>
        <view class="card-row front-row front-crossing"><text class="card-label">通行口岸:</text><text class="card-value">{{ data.crossing }}</text></view>
        <view class="card-row front-row front-issuer"><text class="card-label">签发机关:</text><text class="card-label issuer-value">广东省公安厅交通管理局</text><text class="card-value serial-value">{{ data.serial }}</text></view>
      </view>
        </view>
        <view class="approval-face approval-face--back" :aria-hidden="!isFlipped">
      <svg class="approval-svg" viewBox="0 0 1013 643" role="img" aria-label="批文卡背面">
        <defs>
          <linearGradient id="back-paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f7f6"/><stop offset=".5" stop-color="#eef2f1"/><stop offset="1" stop-color="#f7f7f4"/></linearGradient>
          <pattern id="back-micro" width="34" height="34" patternUnits="userSpaceOnUse"><path d="M0 12h34M0 27h34" stroke="#789198" stroke-width=".55" opacity=".07"/><path d="M6 0c8 8 8 18 0 28M26 4c-8 8-8 18 0 28" fill="none" stroke="#91aaa9" stroke-width=".6" opacity=".055"/><circle cx="17" cy="17" r="1" fill="#778e92" opacity=".05"/></pattern>
          <pattern id="back-watermark" width="170" height="135" patternUnits="userSpaceOnUse"><path d="M26 80c8-37 45-58 72-20 22 30 38 18 49-19M14 112c28-22 58-21 83 1 22 19 39 13 60-9" fill="none" stroke="#8ca8a7" stroke-width="2" opacity=".12"/><circle cx="87" cy="66" r="43" fill="none" stroke="#99b0ad" stroke-width="2" opacity=".08"/></pattern>
          <clipPath id="back-note-clip"><rect x="198" y="486" width="770" height="82"/></clipPath>
        </defs>
        <rect x="2" y="2" width="1009" height="639" rx="28" fill="url(#back-paper)" stroke="#aeb9b8" stroke-width="2"/>
        <rect x="8" y="8" width="997" height="627" rx="23" fill="url(#back-micro)"/><path d="M10 33Q14 9 43 9H970Q996 10 1003 35" fill="none" stroke="#1b2729" stroke-width="4" opacity=".78"/>
        <rect x="8" y="8" width="997" height="627" rx="23" fill="url(#back-watermark)" opacity=".24"/><ellipse cx="463" cy="348" rx="392" ry="287" fill="none" stroke="#7da6ab" stroke-width="1.5" opacity=".08"/><ellipse cx="463" cy="348" rx="317" ry="241" fill="none" stroke="#7da6ab" stroke-width="1.5" opacity=".07"/>
      </svg>
      <view class="card-layer back-layer">
        <view class="card-row back-row back-left back-mainland"><text class="card-label">内地车牌号:</text><text class="card-value">{{ data.mainlandPlate }}</text></view>
        <view class="card-row back-row back-left back-local"><text class="card-label">港澳车牌号:</text><text class="card-value">{{ data.localPlate }}</text></view>
        <view class="card-row back-row back-left driver-row back-driver-one"><text class="card-label">驾　驶　人:</text><text class="card-label driver-index">1.</text><text class="card-value">{{ data.driver1 }}</text></view>
        <view class="card-row back-row back-left driver-row back-driver-two"><text class="driver-spacer"></text><text class="card-label driver-index">2.</text><text class="card-value">{{ data.driver2 }}</text></view>
        <view class="card-row back-row back-left driver-row back-driver-three"><text class="driver-spacer"></text><text class="card-label driver-index">3.</text><text class="card-value">{{ data.driver3 }}</text></view>
        <view class="card-row back-row back-right back-current"><text class="card-label">现批文号:</text><text class="card-value">{{ data.currentApproval }}</text></view>
        <view class="card-row back-row back-right back-previous"><text class="card-label">原批文号:</text><text class="card-value">{{ data.previousApproval }}</text></view>
        <view class="card-row back-row back-right back-color"><text class="card-label">颜　　色:</text><text class="card-value">{{ data.color }}</text></view>
        <view class="card-row back-row back-right back-seats"><text class="card-label">座位/吨位:</text><text class="card-value">{{ data.seats }}</text></view>
        <view class="card-row back-row back-wide back-purpose"><text class="card-label">请予办理:</text><text class="card-value">{{ data.purpose }}</text></view>
        <view class="card-row back-row back-wide back-validity"><text class="card-label">有　效　期:</text><text class="card-value">{{ validity(data.validFrom,data.validTo) }}</text></view>
        <view class="card-row back-row back-wide back-notes"><text class="card-label">备　　注:</text><text class="card-value note-value">{{ data.notes }}</text></view>
        <text class="card-warning">驾驶人仅允许驾驶与本人驾驶证准驾车型相符车辆</text>
      </view>
        </view>
      </view>
    </view>
    <view class="flip-controls" role="group" aria-label="批文卡正反面切換">
      <button class="flip-control" :class="{ active: !isFlipped }" :aria-pressed="!isFlipped" @click="showSide(false)">正面</button>
      <button class="flip-control" :class="{ active: isFlipped }" :aria-pressed="isFlipped" @click="showSide(true)">背面</button>
      <view class="flip-hint">點擊卡面翻轉</view>
    </view>
  </view>
</template>
<script setup>
import { ref,watch } from 'vue'
const props=defineProps({data:{type:Object,required:true},back:{type:Boolean,default:false},flipOnTap:{type:Boolean,default:true},tapLabel:{type:String,default:''}})
const emit=defineEmits(['card-tap','flip'])
const isFlipped=ref(props.back)
watch(()=>props.back,value=>{isFlipped.value=value})
const toggleSide=()=>{if(props.flipOnTap){isFlipped.value=!isFlipped.value;emit('flip',isFlipped.value)}emit('card-tap')}
const showSide=back=>{isFlipped.value=back;emit('flip',back)}
const date=value=>String(value||'').replace(/-/g,'.')
const validity=(a,b)=>a&&b?`${date(a)}–${date(b)}`:date(a||b)
</script>
<style scoped>
.approval-preview{display:grid;gap:12rpx}
.approval-flip-stage{position:relative;width:100%;aspect-ratio:1013/643;perspective:1200px;cursor:pointer;outline-offset:4rpx}
.approval-flip-inner{position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform .65s cubic-bezier(.22,.67,.22,1)}
.approval-flip-inner.is-flipped{transform:rotateY(180deg)}
.approval-face{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;border-radius:13rpx;box-shadow:0 3rpx 10rpx #1b304030;background:#edf2f1;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.approval-face--back{transform:rotateY(180deg)}
.approval-svg{display:block;width:100%;height:100%}
.flip-controls{display:flex;align-items:center;gap:8rpx}
.flip-control{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:68rpx;height:34rpx;margin:0;padding:0 14rpx;border:1px solid #c4d5cd;border-radius:999rpx;background:#f5f8f6;color:#345146;font-size:13rpx;font-weight:650;cursor:pointer;line-height:1}
.flip-control.active{background:#295a48;border-color:#295a48;color:#fff}
.flip-hint{margin-left:auto;color:#668076;font-size:12rpx}
@media (prefers-reduced-motion: reduce){.approval-flip-inner{transition:none}}
</style>

<style scoped>

.approval-face{container-type:inline-size}
.card-layer{position:absolute;inset:0;font-family:'Songti SC','STSong','Noto Serif CJK SC',serif}
.card-layer text{display:block;line-height:1.12;white-space:nowrap}
.card-title{position:absolute;left:16.4%;top:8.8%;width:79%;overflow:hidden;color:#15191b;font-size:3.65cqw;font-weight:750;letter-spacing:.03cqw;text-align:center}
.card-row{position:absolute;display:flex;align-items:baseline;overflow:hidden;white-space:nowrap;line-height:1.12}
.card-row text{position:static;min-width:0;overflow:hidden;text-overflow:clip}
.card-label{color:#062f69;font-size:2.85cqw;font-weight:650;flex:none;transform:translateY(.2cqw)}
.card-value{color:#252525;font-size:3.3cqw;flex:1}
.front-row{left:4.9%;width:91%;align-items:flex-start}
.front-row .card-label:first-child{flex:0 0 16.9%}
.front-number{top:23.4%;min-height:5cqw}
.front-company{top:34.4%}
.front-contractor{top:59.3%}
.front-crossing{top:76.9%}
.front-issuer{top:87.3%;align-items:baseline}
.front-number .card-label,.front-company .card-label{letter-spacing:.5cqw}
.front-number .card-label{transform:translateY(1.25cqw)}
.front-number .number-value{font-family:Arial,sans-serif;font-size:4.45cqw;font-weight:700;letter-spacing:.5cqw}
.front-company .card-value{font-size:3.15cqw}
.front-contractor .card-value{font-size:3.5cqw}
.front-issuer .card-label{font-size:2.45cqw}
.front-issuer .issuer-value{flex:1;transform:translateY(.2cqw)}
.front-issuer .serial-value{flex:0 0 19%;transform:translateY(.3cqw);font-family:Arial,sans-serif;font-size:3.15cqw;font-weight:700;text-align:right;letter-spacing:.2cqw}
.back-row{font-size:3.2cqw}
.back-left{left:4.2%;width:47%}
.back-left .card-label:first-child,.back-left .driver-spacer{flex:0 0 35.6%}
.back-right{left:54.4%;width:43.5%}
.back-right .card-label:first-child{flex:0 0 30.7%}
.back-color .card-label:first-child,.back-seats .card-label:first-child{flex-basis:34.8%}
.back-wide{left:4.2%;width:93.5%}
.back-wide .card-label:first-child{flex:0 0 18%}
.back-right .card-value{font-size:3.05cqw}
.back-mainland,.back-current{top:7.6%}
.back-local,.back-previous{top:17.2%}
.back-driver-one,.back-color{top:26.8%}
.back-driver-two,.back-seats{top:36.4%}
.back-driver-three{top:46%}
.driver-row .driver-index{flex:0 0 8.6%;font-size:2.85cqw}
.back-purpose{top:51.8%}
.back-validity{top:67.1%}
.back-notes{top:77.1%}
.back-notes .note-value{font-size:3.05cqw;white-space:normal;overflow:hidden;line-height:1.1;max-height:2.2em}
.card-warning{position:absolute;left:18%;top:93.1%;width:74%;font-size:2.05cqw;font-weight:650;color:#07386b;text-align:center;overflow:hidden}
</style>
