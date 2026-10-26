Feature: Securities
  In the optional securities mode players buy shares in made-up companies. Prices move
  at the end of each round. Purchased positions are locked for a few rounds; only when in debt
  is there an emergency sale at a discount. This applies on desktop and phone alike.

  Scenario: The host enables securities when creating the game
    When Anna creates a game in Switzerland with securities and a lock period of 5 rounds on the start page
    Then the lobby for Anna shows the notice "Wertpapiere, Sperrfrist 5 Runden"

  Scenario: Without the mode there is no securities section
    Given Anna and Ben play a game in Switzerland
    Then Anna has no "Wertpapiere" section

  Scenario: The price list shows six companies with price and history
    Given Anna and Ben play a game in Switzerland with securities and a lock period of 3 rounds
    When Anna opens the securities
    Then the price list for Anna shows 6 companies with price and price history
    And the price list for Anna shows the price 80 for "Pilatus Bergbahnen AG"
    And the price list for Anna shows the price 40 for "SBB Pünktlichkeits-AG"

  Scenario: Anna buys securities and sees the lock period
    Given Anna and Ben play a game in Switzerland with securities and a lock period of 3 rounds
    And it is Anna's turn
    When Anna buys 5 shares of "Pilatus Bergbahnen AG"
    Then Anna has a balance of 1'600
    And Anna has 5 shares of "Pilatus Bergbahnen AG" in the portfolio
    And the portfolio of Anna shows the lock "noch 3 Runden gesperrt" for "Pilatus Bergbahnen AG"
    And for Anna selling "Pilatus Bergbahnen AG" is blocked with the hint "gesperrt"

  Scenario: The lock period runs out with the rounds
    Given Anna and Ben play a game in Switzerland with securities and a lock period of 3 rounds
    And it is Anna's turn and the dice have been rolled
    When Anna buys 2 shares of "Gotthard Energie AG"
    And Anna ends her turn
    Given it is Ben's turn and the dice have been rolled
    When Ben ends his turn
    Then the round is 2
    And the portfolio of Anna shows the lock "noch 2 Runden gesperrt" for "Gotthard Energie AG"
    And the price of "Gotthard Energie AG" for Anna has a history of 2 prices

  Scenario: After the lock period Anna sells at a profit
    Given Anna and Ben play a game in Switzerland with securities and a lock period of 3 rounds
    And it is Anna's turn
    And Anna owns 10 shares of "Pilatus Bergbahnen AG" at purchase price 80 from round 1
    And it is round 5
    And the price of "Pilatus Bergbahnen AG" is at 100
    Then the portfolio of Anna shows a profit of 200 for "Pilatus Bergbahnen AG"
    When Anna sells the position "Pilatus Bergbahnen AG"
    Then Anna has a balance of 3'000
    And the portfolio of Anna is empty

  Scenario: When in debt Anna sells a locked position in an emergency sale at a discount
    Given Anna and Ben play a game in Switzerland with securities and a lock period of 3 rounds
    And Anna owns 10 shares of "Pilatus Bergbahnen AG" at purchase price 80 from round 1
    And it is round 2
    And Anna has cash of 100
    And Anna owes Ben 500
    Then the portfolio of Anna shows an emergency sale for 640 for "Pilatus Bergbahnen AG"
    When Anna sells the position "Pilatus Bergbahnen AG" as an emergency sale
    Then Anna has a balance of 240
    And Anna sees that Ben has a balance of 2'500
    And the portfolio of Anna is empty

  Scenario: A headline reports a price crash
    Given Anna and Ben play a game in Switzerland with securities and a lock period of 3 rounds
    And a headline reports a crash of "SBB Pünktlichkeits-AG" by 30 percent
    When Anna opens the securities
    Then Anna sees the headline "SBB Pünktlichkeits-AG"

  Scenario: The host switches dividends off when creating the game
    When Anna creates a game in Switzerland with securities and dividends switched off on the start page
    Then the lobby for Anna shows the notice "ohne Dividenden"

  Scenario: Dividends are on by default and appear in the lobby notice
    When Anna creates a game in Switzerland with securities and a lock period of 4 rounds on the start page
    Then the lobby for Anna shows the notice "mit Dividenden"

  Scenario: The securities list shows the yield per company and the expected dividend
    Given Anna and Ben play a game in Switzerland with securities and a lock period of 3 rounds
    And Anna owns 10 shares of "Gotthard Energie AG" at purchase price 70 from round 1
    And Anna owns 10 shares of "SBB Pünktlichkeits-AG" at purchase price 40 from round 1
    When Anna opens the securities
    Then the price list for Anna shows the yield "Dividende 3.0 % pro Runde" for "Gotthard Energie AG"
    And the price list for Anna shows the yield "Dividende 2.5 % pro Runde" for "SBB Pünktlichkeits-AG"
    And the portfolio of Anna shows an expected dividend of 31
    And the portfolio of Anna shows dividends received of 0

  Scenario: The securities list announces that the dividends decay
    Given Anna and Ben play a game in Switzerland with securities and a lock period of 3 rounds
    When Anna opens the securities
    Then the dividend note for Anna says "sinkt ab Runde 20 schrittweise; letzte Zahlung in Runde 60"

  Scenario: A company far below its issue price pays no dividend
    Given Anna and Ben play a game in Switzerland with securities and a lock period of 3 rounds
    And Anna owns 10 shares of "Gotthard Energie AG" at purchase price 70 from round 1
    And the price of "Gotthard Energie AG" is at 30
    When Anna opens the securities
    Then the price list for Anna shows the yield "keine Dividende" for "Gotthard Energie AG"
    And the portfolio of Anna shows an expected dividend of 0

  Scenario: A holder receives a dividend at the end of the round
    Given Anna and Ben play a game in Switzerland with securities and a lock period of 3 rounds
    And Anna owns 10 shares of "Gotthard Energie AG" at purchase price 70 from round 1
    And Anna owns 10 shares of "SBB Pünktlichkeits-AG" at purchase price 40 from round 1
    And Anna has cash of 1000
    And it is Ben's turn and the dice have been rolled
    When Ben ends his turn
    Then the round is 2
    And Anna sees the keyword "Dividende" in the message
    And the dividends received by Anna are above 0 and her balance is 1000 plus that amount

  Scenario: Without dividends nothing is paid at the end of the round
    Given Anna and Ben play a game in Switzerland with securities and dividends switched off
    And Anna owns 10 shares of "Gotthard Energie AG" at purchase price 70 from round 1
    And Anna has cash of 1000
    And it is Ben's turn and the dice have been rolled
    When Anna opens the securities
    Then Anna sees the note that dividends are switched off
    And the portfolio of Anna shows no dividends
    When Ben ends his turn
    Then the round is 2
    And Anna has a balance of 1'000
