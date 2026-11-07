Feature: Auction
  If a player declines the purchase, the property is auctioned.

  Background:
    Given Anna and Ben play a game in Switzerland
    And it is Anna's turn
    And the dice sequence is 2+4

  Scenario: Anna declines, Ben bids and wins the auction
    When Anna rolls
    And Anna declines the purchase
    Then an auction is running for "Weggisgasse"
    And it is Ben's turn to bid
    When Ben bids 40
    Then the auction for Anna shows the highest bid 40 from Ben
    When Anna passes
    Then Ben has a balance of 1'960
    And Ben owns "Weggisgasse"
    And Anna has a balance of 2'000

  Scenario: Automatic bidding
    When Anna rolls
    And Anna declines the purchase
    And Anna sets an auto-bid up to 200
    Then the auction for Anna shows the auto-bid up to 200
    And the auction for Ben shows no auto-bid
    When Ben bids 120
    Then the auction for Anna shows the highest bid 130 from Anna
    And the auction for Ben shows the highest bid 130 from Anna
    When Ben bids 210
    Then Ben owns "Weggisgasse"
    And Ben has a balance of 1'790
    And Anna has a balance of 2'000

  Scenario: Winning the bid with little cash
    Given Ben has cash of 20
    And Ben already owns "Pilatusstrasse"
    When Anna rolls
    And Anna declines the purchase
    And Ben bids 100
    And Anna passes
    Then Ben owns "Weggisgasse"
    And Ben sees the notice that he has to raise money
    When Ben takes out a mortgage on "Weggisgasse"
    And Ben takes out a mortgage on "Pilatusstrasse"
    Then "Weggisgasse" of Ben is mortgaged
    And "Pilatusstrasse" of Ben is mortgaged
    And Ben has a balance of 20
    And Anna can end her turn

  Scenario: Ben sets his bid with the amount field and the quick raises
    When Anna rolls
    And Anna declines the purchase
    Then an auction is running for "Weggisgasse"
    And the auction for Ben shows the list price 100
    When Ben raises the bid by 10
    And Ben raises the bid by 50
    Then the bid amount of Ben shows 70
    When Ben types the bid amount 45
    And Ben places the bid
    Then the auction for Anna shows the highest bid 45 from Ben

  Scenario: Ben bids with the stepper and the primary button
    When Anna rolls
    And Anna declines the purchase
    Then it is Ben's turn to bid
    When Ben raises the bid by 50
    And Ben raises the bid by 10
    And Ben lowers the bid by 10
    Then the bid button of Ben offers 60
    When Ben places the bid
    Then the auction for Anna shows the highest bid 60 from Ben

  Scenario: The auto-bid controls stay behind a disclosure until they are opened
    When Anna rolls
    And Anna declines the purchase
    Then the auto-bid controls of Anna are collapsed
    When Anna opens the auto-bid controls
    Then the auto-bid controls of Anna are open

  Scenario: The auction names the leading bidder, whose turn it is and the own cash
    When Anna rolls
    And Anna declines the purchase
    Then the auction for Ben says "Du bist dran"
    And the auction for Anna says "Ben ist mit Bieten dran"
    When Ben bids 40
    Then the auction for Anna shows Ben as the leading bidder
    And the auction for Anna shows the own cash 2'000
    And the auction for Ben shows the own cash 2'000
    And the auction for Anna says "Du bist dran"

  @desktop
  Scenario: Only what matters is shown while Ben is bidding
    When Anna rolls
    And Anna declines the purchase
    Then it is Ben's turn to bid
    And Ben sees neither the trade button nor the give-up flag
    And Ben still sees the properties button
    And Anna sees the trade button

  Scenario: The HUD tells who is on the move and who is bidding
    When Anna rolls
    And Anna declines the purchase
    Then Ben sees that Anna is on the move while Ben is bidding
    And Anna sees that Anna is on the move while Ben is bidding

  Scenario: The auto-bid maximum is explained
    When Anna rolls
    And Anna declines the purchase
    When Anna opens the auto-bid controls
    Then Anna sees the explanation of the auto-bid maximum
